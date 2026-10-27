import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { checkSetup, probe } from "../../scripts/launcher/start.mjs";

const execute = promisify(execFile);
const output = resolve("test-results/launcher");
mkdirSync(output, { recursive: true });
function fixture() {
  return mkdtempSync(resolve(output, "fixture-"));
}
function write(root, name, body) {
  const file = resolve(root, name);
  assert.ok(file.startsWith(root + "/") || file.startsWith(root + "\\"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

test("checks Node, project, dependencies, settings and the game before starting", () => {
  const root = fixture();
  assert.throws(() => checkSetup(root, "22.0.0"), /Node.js 24/);
  write(root, "package.json", JSON.stringify({ name: "another-project" }));
  assert.throws(() => checkSetup(root, "24.0.0"), /project folder/);
  write(root, "package.json", JSON.stringify({ name: "mosslight-ecosystem" }));
  write(root, "apps/web/package.json", "{}");
  assert.throws(() => checkSetup(root), /npm ci/);
  write(root, "node_modules/next/dist/bin/next", "// Local test fixture only.");
  assert.throws(() => checkSetup(root), /Local settings/);
  write(
    root,
    "apps/web/.env.local",
    "# Empty synthetic fixture, no credentials.",
  );
  assert.throws(() => checkSetup(root), /game export/);
  for (const file of [
    "index.html",
    "js/rmmz_core.js",
    "js/plugins/MosslightBridge.js",
    "js/libs/effekseer.wasm",
  ])
    write(root, "apps/web/public/games/mosslight/" + file, "fixture");
  assert.equal(checkSetup(root).cwd, resolve(root, "apps/web"));
});

test("distinguishes Lantern Vale, another service and a closed port without stopping either service", async () => {
  let html = "<title>Another app</title>";
  const server = createServer((_request, response) => response.end(html));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await probe(url), "occupied");
    html = "<!doctype html><title>Lantern Vale</title>";
    assert.equal(await probe(url), "ready");
    assert.ok(server.listening);
    await assert.rejects(probe("https://example.com"), /loopback/);
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.equal(await probe(url), "free");
});

test(
  "the built executable checks the real checkout without opening a browser",
  { skip: process.platform !== "win32" },
  async () => {
    const result = await execute(resolve("Lantern Vale.exe"), ["--check"], {
      windowsHide: true,
      timeout: 10_000,
    });
    assert.match(result.stdout, /PASS: local prerequisites/);
  },
);

test(
  "closing the launcher terminates its child and grandchild processes",
  { skip: process.platform !== "win32", timeout: 15_000 },
  async () => {
    const root = fixture();
    const binary = resolve(root, "Lantern Vale.exe");
    copyFileSync(resolve("Lantern Vale.exe"), binary);
    write(
      root,
      "scripts/launcher/start.mjs",
      `import {spawn} from 'node:child_process';
    import {writeFileSync} from 'node:fs';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
    writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));
    setInterval(()=>{},1000);`,
    );
    const launcher = spawn(binary, ["--no-browser"], {
      cwd: root,
      windowsHide: true,
      stdio: "ignore",
    });
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      for (let i = 0; i < 100 && !existsSync(resolve(root, "pids.json")); i++)
        await delay(50);
      assert.ok(
        existsSync(resolve(root, "pids.json")),
        "The isolated fixture started",
      );
      const pids = JSON.parse(readFileSync(resolve(root, "pids.json"), "utf8"));
      assert.ok(pids.every(alive));
      launcher.kill();
      for (let i = 0; i < 100 && pids.some(alive); i++) await delay(50);
      assert.ok(
        pids.every((pid) => !alive(pid)),
        "The Windows job closes every owned descendant",
      );
    } finally {
      if (launcher.exitCode === null) launcher.kill();
    }
  },
);
