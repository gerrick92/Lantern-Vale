import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { effectResources } from "./effect-resources.mjs";

const extensions = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".wasm",
  ".txt",
  ".png",
  ".webp",
  ".ogg",
  ".m4a",
  ".woff",
  ".woff2",
  ".ttf",
  ".rmmzimg",
  ".rmmzaud",
  ".efkefc",
  ".efkmodel",
]);

export function clientPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value
      .split("/")
      .some((part) => !part || part.startsWith(".") || part.includes(":")) ||
    !extensions.has(extname(value).toLowerCase())
  )
    throw new Error(
      "Unexpected path in the game export. Only game client files are allowed.",
    );
  return value;
}

export function gameFiles(root, source = false) {
  const files = [];
  function walk(folder, prefix = "") {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Game exports must not contain symlinks.");
      if (entry.isDirectory()) {
        if (entry.name.startsWith("."))
          throw new Error("Hidden directories must not be exported.");
        walk(join(folder, entry.name), path + "/");
      } else if (source && path === "Game.rmmzproject") continue;
      else if (!source && path === ".gitkeep") continue;
      else files.push(clientPath(path));
    }
  }
  walk(root);
  return files.sort();
}

export function verifyGame({
  source = resolve("game/mz-source"),
  target = resolve("apps/web/public/games/mosslight"),
  manifestFile = resolve("game/export-manifest.json"),
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (!Array.isArray(manifest) || !manifest.length)
    throw new Error("Empty game manifest.");
  const expected = new Set();
  for (const item of manifest) {
    clientPath(item.path);
    if (
      expected.has(item.path) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      !/^[0-9a-f]{64}$/.test(item.sha256)
    )
      throw new Error("Invalid game manifest entry.");
    expected.add(item.path);
  }
  for (const [folder, isSource] of [
    [source, true],
    [target, false],
  ]) {
    const actual = gameFiles(folder, isSource);
    if (
      actual.length !== expected.size ||
      actual.some((path) => !expected.has(path))
    )
      throw new Error(
        "Source/export file lists differ from the manifest. Review stale or missing files before release.",
      );
    for (const item of manifest) {
      const content = readFileSync(join(folder, item.path));
      if (
        content.length !== item.bytes ||
        createHash("sha256").update(content).digest("hex") !== item.sha256
      )
        throw new Error(`Game checksum mismatch: ${item.path}`);
    }
  }
  if (!existsSync(join(source, "Game.rmmzproject")))
    throw new Error("Missing MZ authoring project.");
  function required(path) {
    clientPath(path);
    if (!expected.has(path))
      throw new Error(`Missing referenced game resource: ${path}`);
  }
  for (const path of [
    "index.html",
    "js/main.js",
    "js/plugins.js",
    "js/practice-config.js",
    "js/plugins/MosslightRules.js",
    "js/plugins/MosslightBridge.js",
    "js/libs/effekseer.wasm",
    "data/System.json",
    "data/MapInfos.json",
    "data/Tilesets.json",
    "CREDITS.txt",
    "THIRD_PARTY_LICENSES.txt",
  ])
    required(path);
  const read = (path) => readFileSync(join(target, path), "utf8");
  const json = (path) => JSON.parse(read(path));
  for (const match of read("index.html").matchAll(/(?:src|href)="([^"]+)"/g))
    required(match[1]);
  for (const match of read("js/main.js").matchAll(
    /"(js\/[^"\n]+\.(?:js|wasm))"/g,
  ))
    required(match[1]);
  const pluginSource = read("js/plugins.js");
  const plugins = JSON.parse(
    pluginSource.slice(
      pluginSource.indexOf("["),
      pluginSource.lastIndexOf("]") + 1,
    ),
  );
  for (const plugin of plugins)
    if (plugin.status) required(`js/plugins/${plugin.name}.js`);
  const tilesets = json("data/Tilesets.json");
  for (const info of json("data/MapInfos.json").filter(Boolean)) {
    const path = `data/Map${String(info.id).padStart(3, "0")}.json`;
    required(path);
    const map = json(path);
    for (const name of tilesets[map.tilesetId].tilesetNames.filter(Boolean))
      required(`img/tilesets/${name}.png`);
    for (const event of map.events.filter(Boolean))
      for (const page of event.pages)
        if (page.image.characterName)
          required(`img/characters/${page.image.characterName}.png`);
    if (map.autoplayBgm && map.bgm.name)
      required(`audio/bgm/${map.bgm.name}.ogg`);
    if (map.autoplayBgs && map.bgs.name)
      required(`audio/bgs/${map.bgs.name}.ogg`);
  }
  for (const animation of json("data/Animations.json").filter(Boolean)) {
    if (!animation.effectName) continue;
    const path = `effects/${animation.effectName}.efkefc`;
    required(path);
    for (const resource of effectResources(readFileSync(join(target, path))))
      required(`effects/${resource}`);
    for (const timing of animation.soundTimings)
      if (timing.se.name) required(`audio/se/${timing.se.name}.ogg`);
  }
  return {
    files: expected.size,
    bytes: manifest.reduce((sum, item) => sum + item.bytes, 0),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = verifyGame();
  console.log(
    `PASS: ${result.files} source/export files match their SHA-256 manifest; runtime, plugins, maps and map resources are present. No files were changed.`,
  );
}
