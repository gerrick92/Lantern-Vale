import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(".");
const origin = "http://127.0.0.1:3001";
const server = spawn(
  process.execPath,
  [
    resolve("node_modules/next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  {
    cwd: resolve("apps/web"),
    env: { ...process.env, APP_ORIGIN: origin },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let serverError = "";
server.stderr.on("data", (chunk) => {
  serverError = (serverError + String(chunk)).slice(-2000);
});
async function run(script, args = [], env = {}) {
  const child = spawn(process.execPath, [resolve(script), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, `${script} did not pass.`);
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null)
      throw new Error(
        "The isolated production server could not start. Check that port 3001 is free.",
      );
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* The child server is still starting. */
    }
    await delay(250);
  }
  assert.ok(
    ready && server.exitCode === null && !serverError.includes("EADDRINUSE"),
    "Production server did not become ready.",
  );
  for (const path of [
    "/dev/play",
    "/dev/deploy",
    "/dev/deploy/game",
    "/dev/deploy/game/verify",
    "/adventure/test",
  ]) {
    const response = await fetch(origin + path);
    assert.equal(
      response.status,
      404,
      `${path} must be unavailable in production.`,
    );
  }
  const developerPost = await fetch(origin + "/dev/deploy/game/verify", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(developerPost.status, 404);
  const game = await fetch(origin + "/games/mosslight/index.html", {
    redirect: "manual",
  });
  assert.equal(game.status, 307);
  assert.match(game.headers.get("location"), /\/auth$/);
  assert.match(game.headers.get("cache-control"), /no-store/);
  const home = await fetch(origin);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.ok(
    !home.headers.get("content-security-policy").includes("'unsafe-eval'"),
    "Account pages must not allow unsafe-eval in production.",
  );
  console.log(
    "PASS: production-only route restrictions, private game entry and website security headers.",
  );
  await run(
    "node_modules/@playwright/test/cli.js",
    [
      "test",
      "tests/browser/account-data.spec.ts",
      "--reporter=list",
      "--output=test-results/production",
    ],
    { TEST_BASE_URL: origin },
  );
  await run("scripts/lighthouse.mjs");
} finally {
  // Stop only the temporary server created here; leave the user's development server alone.
  if (server.exitCode === null) server.kill();
}
