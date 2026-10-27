import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export const origin = "http://127.0.0.1:3000";

export function checkSetup(root, version = process.versions.node) {
  if (Number(version.split(".")[0]) !== 24)
    throw new Error("Install Node.js 24 LTS, then reopen this launcher.");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (pkg.name !== "mosslight-ecosystem")
    throw new Error(
      "Keep Lantern Vale.exe in the Lantern Vale project folder.",
    );
  // Resolve only the app's installation or its workspace-hoisted installation.
  const next = [
    resolve(root, "apps/web/node_modules/next/dist/bin/next"),
    resolve(root, "node_modules/next/dist/bin/next"),
  ].find(existsSync);
  if (!next) {
    throw new Error(
      "Dependencies are missing. Run npm ci once in this folder.",
    );
  }
  if (!existsSync(resolve(root, "apps/web/.env.local")))
    throw new Error(
      "Local settings are missing. Follow Installation in README.md.",
    );
  for (const file of [
    "index.html",
    "js/rmmz_core.js",
    "js/plugins/MosslightBridge.js",
    "js/libs/effekseer.wasm",
  ])
    if (!existsSync(resolve(root, "apps/web/public/games/mosslight", file)))
      throw new Error(
        "The finished game export is missing. Follow docs/GAME.md.",
      );
  return { next, cwd: resolve(root, "apps/web") };
}

export async function probe(url = origin) {
  const address = new URL(url);
  if (address.hostname !== "127.0.0.1" || address.protocol !== "http:")
    throw new Error("The local launcher only checks IPv4 loopback HTTP.");
  const connected = await new Promise((done) => {
    const socket = createConnection({
      host: address.hostname,
      port: Number(address.port),
    });
    const finish = (value) => {
      socket.destroy();
      done(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (error) =>
      finish(error.code === "ECONNREFUSED" ? false : true),
    );
    socket.setTimeout(800, () => finish(true));
  });
  if (!connected) return "free";
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return "occupied";
    }
    const reader = response.body.getReader();
    let body = "";
    const decoder = new TextDecoder();
    try {
      while (body.length < 128 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
        if (/<title>Lantern Vale(?:\s|<|[·—|])/.test(body)) return "ready";
      }
    } finally {
      await reader.cancel();
    }
  } catch {
    /* A listening but unresponsive port is never treated as available. */
  }
  return "occupied";
}

export async function run(root, args = process.argv.slice(2)) {
  if (args.some((arg) => !["--check", "--no-browser"].includes(arg)))
    throw new Error("Supported options: --check, --no-browser.");
  const setup = checkSetup(root);
  console.log(
    "Lantern Vale | Local launcher\nNode.js 24, dependencies, settings and game files found.",
  );
  if (args.includes("--check")) {
    console.log("PASS: local prerequisites are present.");
    return;
  }
  const running = await probe();
  if (running === "ready") {
    console.log(`Lantern Vale is already running at ${origin}. Reusing it.`);
    console.log(`Ready: ${origin}`);
    return;
  }
  if (running !== "free")
    throw new Error(
      "Port 3000 is busy or its server is still starting. Nothing was stopped. Wait and try again.",
    );
  console.log(
    "Starting the web app. Keep this window open; Ctrl+C stops this session.\n",
  );
  const server = spawn(
    process.execPath,
    [
      setup.next,
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ],
    {
      cwd: setup.cwd,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=3072" },
    },
  );
  let stopped = false;
  let failed;
  const ended = new Promise((done) => {
    server.once("error", (error) => {
      failed = error;
      stopped = true;
      done();
    });
    server.once("exit", (code) => {
      stopped = true;
      if (code)
        failed = new Error(
          `Web server exited (${code}). Read the message above.`,
        );
      done();
    });
  });
  const stop = () => {
    if (!stopped) server.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    let ready = false;
    const deadline = Date.now() + 120_000;
    while (!stopped && Date.now() < deadline) {
      if ((await probe()) === "ready") {
        ready = true;
        break;
      }
      await delay(750);
    }
    if (!ready)
      throw (
        failed ||
        new Error(
          "The app did not become ready within two minutes. Check the server output above.",
        )
      );
    console.log(
      `\nReady: ${origin}\nSupabase and Sepolia stay hosted; no extra database terminal is needed.`,
    );
    await ended;
    if (failed) throw failed;
  } finally {
    stop();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  run(root).catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
