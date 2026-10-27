import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runtimeNotices } from "../../game/scripts/licenses.mjs";

it("keeps complete runtime notices in the editable game and finished export", () => {
  const generated = runtimeNotices();
  for (const name of [
    "PixiJS",
    "Effekseer",
    "localForage",
    "lie (localForage promise polyfill)",
    "immediate (localForage scheduler)",
    "Apache License",
    "Pako",
    "stb_vorbis",
    "M+ fonts",
    "Zod",
  ])
    expect(generated).toContain(name);
  expect(generated).toContain("END OF TERMS AND CONDITIONS");
  expect(generated).toContain("Copyright (C) 2002-2017 M+ FONTS PROJECT");
  for (const directory of ["game/mz-source", "apps/web/public/games/mosslight"])
    expect(readFileSync(`${directory}/THIRD_PARTY_LICENSES.txt`, "utf8")).toBe(
      generated,
    );
});
