import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { buildMaps } from "./maps.mjs";
import { buildPlugins } from "./plugins.mjs";
import { buildRules } from "./rules.mjs";
import { effectResources } from "./effect-resources.mjs";
import { runtimeNotices } from "./licenses.mjs";
const install =
  process.env.RPG_MZ_PATH || "C:/Linus/Steam/steamapps/common/RPG Maker MZ";
const base = join(install, "newdata"),
  core = join(install, "corescript/v1.9.0"),
  output = resolve("game/mz-source");
if (
  !existsSync(join(install, "RPGMZ.exe")) ||
  !existsSync(join(core, "rmmz_core.js"))
)
  throw new Error("A licensed MZ 1.9.0 installation is required to build.");
const read = (name) =>
  JSON.parse(readFileSync(join(base, `data/${name}.json`), "utf8"));
const write = (file, value) => {
  mkdirSync(resolve(output, file, ".."), { recursive: true });
  writeFileSync(
    join(output, file),
    typeof value === "string" ? value : JSON.stringify(value),
  );
};
function copy(file) {
  const source = join(base, file);
  if (!existsSync(source)) throw new Error(`Missing official asset: ${file}`);
  mkdirSync(resolve(output, file, ".."), { recursive: true });
  cpSync(source, join(output, file), { recursive: true });
}
await build({
  entryPoints: ["game/rules/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: ".tools/game-rules.mjs",
});
const R = await import("../../.tools/game-rules.mjs");
await buildRules();
await buildPlugins();
for (const folder of ["css", "fonts", "icon"]) copy(folder);
cpSync(core, join(output, "js"), { recursive: true });
const system = read("System");
Object.assign(system.advanced, {
  windowOpacity: 218,
  picturesUpperLimit: 100,
  screenWidth: 960,
  screenHeight: 720,
  uiAreaWidth: 960,
  uiAreaHeight: 720,
});
Object.assign(system, {
  gameTitle: "Lantern Vale",
  locale: "en_US",
  tileSize: 48,
  startMapId: 1,
  startX: 4,
  startY: 7,
  partyMembers: [1],
  optAutosave: false,
  optFollowers: false,
  optSideView: true,
  title1Name: "Mosslight",
  title2Name: "",
  menuCommands: [false, false, false, false, false, false],
  titleBgm: { name: "Theme4", volume: 45, pitch: 100, pan: 0 },
});
write("data/System.json", system);
const actor = read("Actors")[1],
  klass = read("Classes")[1];
write("data/Classes.json", [
  null,
  ...R.classIds.map((id, i) => ({
    ...klass,
    id: i + 1,
    name: R.classes[id].name,
    learnings: [],
  })),
]);
write("data/Actors.json", [
  null,
  ...R.classIds.map((id, i) => ({
    ...actor,
    id: i + 1,
    name: R.classes[id].name,
    classId: i + 1,
    characterName: R.classes[id].character,
    characterIndex: R.classes[id].index,
    battlerName: R.classes[id].battler,
    faceName: R.classes[id].character,
    faceIndex: R.classes[id].index,
    equips: [0, 0, 0, 0, 0],
    note: "Presentation only. Paid progress is server-controlled.",
  })),
]);
for (const name of ["Skills", "Items", "Weapons", "Armors", "States"])
  write(`data/${name}.json`, read(name));
for (const name of ["Enemies", "Troops", "CommonEvents"])
  write(`data/${name}.json`, [null]);
const effectIds = new Set([
  1, 2, 6, 7, 11, 16, 41, 51, 57, 58, 59, 66, 67, 76, 86, 87, 91, 96, 101, 106,
]);
const animations = read("Animations").map((animation) =>
  animation && effectIds.has(animation.id) ? animation : null,
);
write("data/Animations.json", animations);
for (const animation of animations.filter(Boolean)) {
  const file = `effects/${animation.effectName}.efkefc`;
  copy(file);
  for (const resource of effectResources(readFileSync(join(base, file))))
    copy(`effects/${resource}`);
  for (const timing of animation.soundTimings)
    if (timing.se.name) copy(`audio/se/${timing.se.name}.ogg`);
}
const tilesets = read("Tilesets");
// Native outdoor terrain, with the dungeon cave arch on the C decoration sheet.
tilesets[2].tilesetNames[6] = "Dungeon_B";
for (let tile = 184; tile <= 189; tile++) tilesets[3].flags[tile] |= 0x80;
for (const tile of [112, 113]) tilesets[3].flags[tile] |= 0x80;
write("data/Tilesets.json", tilesets);
const source = readFileSync(join(core, "rmmz_core.js"), "utf8");
const floorTable = JSON.parse(
  source.match(/Tilemap.FLOOR_AUTOTILE_TABLE = (\[[\s\S]*?\]);/)[1],
);
buildMaps({ R, floorTable, write });
for (const id of [2, 3, 4])
  for (const name of tilesets[id].tilesetNames.filter(Boolean))
    copy(`img/tilesets/${name}.png`);
for (const name of [
  "Actor1",
  "Actor2",
  "Actor3",
  "People1",
  "People2",
  "Nature",
  "Monster",
  "Evil",
  "Vehicle",
  "!Door1",
  "!Flame",
])
  copy(`img/characters/${name}.png`);
for (const name of ["Actor1", "Actor2", "Actor3"])
  copy(`img/faces/${name}.png`);
for (const c of Object.values(R.classes))
  copy(`img/sv_actors/${c.battler}.png`);
for (const e of R.enemies) copy(`img/enemies/${e.image}.png`);
for (const name of [
  "Window",
  "IconSet",
  "ButtonSet",
  "Shadow1",
  "Shadow2",
  "Weapons1",
  "Weapons2",
  "Weapons3",
  "Balloon",
  "States",
])
  copy(`img/system/${name}.png`);
for (const name of ["Forest", "RockCave"]) copy(`img/battlebacks2/${name}.png`);
for (const name of ["Grassland", "RockCave"])
  copy(`img/battlebacks1/${name}.png`);
for (const name of [
  "Theme4",
  "Town4",
  "Field2",
  "Dungeon2",
  "Dungeon5",
  "Scene2",
  "Scene3",
  "Battle2",
  "Battle6",
  "Battle8",
])
  copy(`audio/bgm/${name}.ogg`);
for (const name of ["Victory1", "Defeat1", "Gameover1"])
  copy(`audio/me/${name}.ogg`);
for (const name of ["Blow1", "Magic1", "Heal1", "Slash1"])
  copy(`audio/se/${name}.ogg`);
for (const sound of system.sounds) copy(`audio/se/${sound.name}.ogg`);
mkdirSync(join(output, "img/titles1"), { recursive: true });
cpSync(
  "apps/web/public/art/lantern-vale-v1.png",
  join(output, "img/titles1/Mosslight.png"),
);
write(
  "js/plugins.js",
  "var $plugins =\n" +
    JSON.stringify([
      {
        name: "MosslightRules",
        status: true,
        description: "Shared rules",
        parameters: {},
      },
      {
        name: "MosslightBridge",
        status: true,
        description: "Mosslight MZ adventure",
        parameters: {},
      },
    ]) +
    ";\n",
);
write(
  "js/practice-config.js",
  `window.MOSSLIGHT_PRACTICE_ENABLED = ${!process.argv.includes("--release")};\n`,
);
write("Game.rmmzproject", "RPGMZ 1.9.0");
write(
  "index.html",
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lantern Vale · RPG Maker MZ</title><link rel="icon" href="icon/icon.png"><link rel="stylesheet" href="css/game.css"></head><body style="background:#081913"><script src="js/practice-config.js"></script><script src="js/main.js"></script></body></html>',
);
write(
  "CREDITS.txt",
  "Lantern Vale is made with RPG Maker MZ.\n©Gotcha Gotcha Games Inc./YOJI OJIMA 2020\nOriginal maps, dialogue, rules and MosslightBridge plugin. Original generated cover art: OpenAI image generation, 20 October 2026.\nOfficial assets may only be redistributed as part of this finished user game under the RPG Maker MZ license. No DLC or purchased music used.\nPlayers may not extract or modify RPG Maker company programs or assets from this game, redistribute extracted resources, or use extracted assets in other games.\n",
);
write("THIRD_PARTY_LICENSES.txt", runtimeNotices());
writeFileSync(
  "game/asset-provenance.json",
  JSON.stringify(
    {
      engine: "RPG Maker MZ",
      version: "1.9.0",
      source: "Licensed local installation: newdata and corescript/v1.9.0",
      eula: "https://store.steampowered.com/eula/1096900_eula_1",
      distribution:
        "Finished user game only; raw official assets excluded from Git.",
      maps: "Five original authored maps in game/scripts/maps.mjs",
      plugins: [
        "MosslightRules — shared project rules",
        "MosslightBridge — original MZ presentation",
      ],
      music: {
        inn: "Town4",
        exploration: "Field2 / Dungeon2 / Dungeon5",
        fairy: "Scene2",
        bedroom: "Scene3",
        battle: "Battle2",
        boss: "Battle8",
        victory: "Victory1",
      },
      dlc: [],
      battleEffects: animations
        .filter(Boolean)
        .map((animation) => animation.effectName),
      practice: !process.argv.includes("--release"),
    },
    null,
    2,
  ),
);
console.log(
  "PASS: built five fresh MZ maps, six classes, shared rules and licensed soundtrack. Run game:sync.",
);
