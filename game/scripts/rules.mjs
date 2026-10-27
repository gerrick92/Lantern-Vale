import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function buildRules() {
  await build({
    entryPoints: ["game/rules/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "MosslightRules",
    target: "es2022",
    minify: true,
    outfile: "game/mz-source/js/plugins/MosslightRules.js",
    banner: {
      js: "/*: @target MZ\n * @plugindesc Shared Lantern Vale rules. Local testing is never reward authority.\n */",
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildRules();
  console.log(
    "PASS: rebuilt shared MZ rules without changing maps, assets or the practice release switch.",
  );
}
