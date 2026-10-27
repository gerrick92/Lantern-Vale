import { existsSync, cpSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const local = resolve(
  "node_modules/@foundry-rs/forge-win32-amd64/bin/forge.exe",
);
const binary =
  process.platform === "win32" && existsSync(local) ? local : "forge";
// Keep dependency sources inside the Foundry root for coverage source resolution.
mkdirSync(resolve("contracts/lib"), { recursive: true });
cpSync(
  resolve("node_modules/@openzeppelin/contracts"),
  resolve("contracts/lib/openzeppelin-contracts"),
  { recursive: true },
);
const result = spawnSync(binary, process.argv.slice(2), {
  cwd: resolve("contracts"),
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
