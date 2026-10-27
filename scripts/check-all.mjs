import { spawn } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.some((arg) => !["--offline", "--list"].includes(arg)))
  throw new Error("Supported options: --offline, --list.");
const offline = args.includes("--offline");

const stages = [
  "typecheck",
  "typecheck:signer",
  "lint",
  "format:check",
  "test",
  "contracts:format:check",
  "contracts:test",
  ...(offline ? [] : ["game:rules", "game:plugins", "game:sync"]),
  "game:verify",
  "build",
  "release:package",
  ...(offline
    ? ["test:e2e:offline"]
    : ["test:e2e", "test:hosted", "test:account", "test:production"]),
];
if (args.includes("--list")) {
  console.log(JSON.stringify(stages));
  process.exit(0);
}
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run with npm run test:offline or npm run test:all.");

for (const name of stages) {
  console.log(`\nChecking ${name}...`);
  const child = spawn(process.execPath, [npm, "run", name], {
    cwd: resolve("."),
    env: process.env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    process.exitCode = 1;
    console.error(`FAIL: ${name}. Later checks were not run.`);
    break;
  }
}
