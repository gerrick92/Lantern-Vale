import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { build } from "esbuild";
import { buildMaps } from "./maps.mjs";

// Regenerate authored maps without touching the database, assets or release switch.
await build({
  entryPoints: ["game/rules/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: ".tools/map-rules.mjs",
});
const R = await import("../../.tools/map-rules.mjs");
const root = "game/mz-source";
const core = readFileSync(join(root, "js/rmmz_core.js"), "utf8");
const floorTable = JSON.parse(
  core.match(/Tilemap.FLOOR_AUTOTILE_TABLE = (\[[\s\S]*?\]);/)[1],
);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const cave = readFileSync(join(root, "data/Map005.json"));
if (
  hash(cave) !==
  "96fbeb700c4da10cbb31be635888ebd47d30fca7734afc46b7dc1c07a3c7d071"
)
  throw new Error(
    "The approved cave has changed. Preserve and review it before rebuilding maps.",
  );
const pending = [];
buildMaps({
  R,
  floorTable,
  write: (file, value) => {
    const next = JSON.stringify(value);
    if (file === "data/Map005.json") {
      if (hash(next) !== hash(cave))
        throw new Error("Map generation would change the approved cave.");
      return;
    }
    const path = join(root, file);
    if (readFileSync(path, "utf8") !== next) pending.push({ path, file, next });
  },
});
if (pending.length) {
  const backup = join(
    "test-results",
    "map-backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  for (const { path, file, next } of pending) {
    const saved = join(backup, file);
    mkdirSync(join(saved, ".."), { recursive: true });
    copyFileSync(path, saved);
    writeFileSync(path, next);
  }
}
console.log(
  `PASS: regenerated ${pending.length} map files; previous maps backed up and approved cave untouched.`,
);
