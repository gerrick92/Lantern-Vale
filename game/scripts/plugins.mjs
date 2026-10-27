import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function buildPlugins() {
  await build({
    entryPoints: ["game/plugins/bridge.js"],
    bundle: true,
    format: "iife",
    target: "es2022",
    keepNames: true,
    outfile: "game/mz-source/js/plugins/MosslightBridge.js",
    banner: {
      js: "/*: @target MZ\n * @plugindesc Lantern Vale presentation. Generated from game/plugins; run npm run game:plugins.\n * @help Practice has no reward authority. Paid actions require the authenticated server.\n */",
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildPlugins();
  console.log("PASS: rebuilt MZ presentation without changing maps or assets.");
}
