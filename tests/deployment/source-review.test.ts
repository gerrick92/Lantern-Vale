import { expect, it } from "vitest";
import { inspectSource, sourcePath } from "../../scripts/review-source.mjs";

it("permits original authoring data but excludes licensed runtime, secrets and backups", () => {
  for (const path of [
    "game/mz-source/data/Map005.json",
    "game/mz-source/Game.rmmzproject",
    "game/mz-source/js/plugins/MosslightBridge.js",
    ".gitignore",
  ])
    expect(() => sourcePath(path)).not.toThrow();
  for (const path of [
    ".tools/private/config.json",
    "apps/web/.env.local",
    "game/mz-source/img/characters/Actor1.png",
    "game/mz-source/js/rmmz_core.js",
    "apps/web/public/games/mosslight/index.html",
    "docs/archive.dump",
    "../outside.txt",
    "x/../file.ts",
  ])
    expect(() => sourcePath(path)).toThrow();
});

it("checks credentials in authoring data and all source languages", () => {
  const credential = Buffer.from("sb_secret_" + "x".repeat(40));
  for (const path of [
    "contracts/src/Example.sol",
    "scripts/launcher/Example.cs",
    "game/mz-source/data/System.json",
  ])
    expect(() => inspectSource(path, credential)).toThrow(
      "Potential credential",
    );
  expect(() =>
    inspectSource("docs/image.png", Buffer.from("PGDMP\x01fixture")),
  ).toThrow("Database backup");
  expect(() =>
    inspectSource(".env.example", Buffer.from("KEY=not-empty")),
  ).toThrow("empty placeholders");
});
