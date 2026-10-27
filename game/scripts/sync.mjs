import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { gameFiles, verifyGame } from "./verify.mjs";
import { runtimeNotices } from "./licenses.mjs";
const source = resolve("game/mz-source"),
  target = resolve("apps/web/public/games/mosslight");
for (const file of [
  "Game.rmmzproject",
  "index.html",
  "data/Map001.json",
  "data/Map002.json",
  "js/rmmz_core.js",
  "js/plugins/MosslightBridge.js",
  "js/libs/effekseer.wasm",
])
  if (!existsSync(join(source, file)))
    throw new Error(`Missing required source file: ${file}`);
// Check the whole source before copying anything into the public directory.
gameFiles(source, true);
writeFileSync(join(source, "THIRD_PARTY_LICENSES.txt"), runtimeNotices());
mkdirSync(target, { recursive: true });
const manifest = [];
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Game resources must not use symlinks.");
    if (entry.isDirectory()) walk(path);
    else {
      const rel = relative(source, path).replaceAll("\\", "/");
      if (rel.endsWith(".rmmzproject")) continue;
      mkdirSync(resolve(target, rel, ".."), { recursive: true });
      cpSync(path, join(target, rel));
      manifest.push({
        path: rel,
        bytes: statSync(path).size,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    }
  }
}
walk(source);
manifest.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync("game/export-manifest.json", JSON.stringify(manifest, null, 2));
verifyGame();
console.log(
  `PASS: synchronized and verified ${manifest.length} files (${(manifest.reduce((sum, item) => sum + item.bytes, 0) / 1024 / 1024).toFixed(1)} MiB). No Steam installation is needed to play the exported game.`,
);
