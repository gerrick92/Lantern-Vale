import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
type MapData = {
  width: number;
  height: number;
  data: number[];
  events: ({ x: number; y: number; name: string; note: string } | null)[];
};
function map(id: number): MapData {
  return JSON.parse(
    readFileSync(
      `game/mz-source/data/Map${String(id).padStart(3, "0")}.json`,
      "utf8",
    ),
  );
}
function reachable(m: MapData, x: number, y: number) {
  const seen = new Set([`${x},${y}`]),
    queue = [[x, y]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        key = `${nx},${ny}`;
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= m.width ||
        ny >= m.height ||
        seen.has(key) ||
        m.data[(5 * m.height + ny) * m.width + nx] !== 254
      )
        continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}
describe("Authored MZ map routes", () => {
  it("covers every open forest boundary tile with a transfer event", () => {
    for (const id of [3, 4]) {
      const m = map(id);
      for (const y of [0, m.height - 1])
        for (let x = 0; x < m.width; x++)
          if (m.data[(5 * m.height + y) * m.width + x] === 254)
            expect(
              m.events.some(
                (e) => e?.x === x && e.y === y && e.name.startsWith("Road"),
              ),
              `Map ${id} exit ${x},${y}`,
            ).toBe(true);
    }
  });
  it("preserves the approved final cave byte for byte", () => {
    expect(
      createHash("sha256")
        .update(readFileSync("game/mz-source/data/Map005.json"))
        .digest("hex"),
    ).toBe("96fbeb700c4da10cbb31be635888ebd47d30fca7734afc46b7dc1c07a3c7d071");
  });
  it("uses whole tree crowns and trunks instead of flat leaf terrain", () => {
    for (const id of [2, 3, 4]) {
      const m = map(id),
        size = m.width * m.height;
      expect(
        m.data
          .slice(size, size * 2)
          .some((tile) => tile >= 7472 && tile < 7520),
      ).toBe(false);
      let trees = 0;
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) {
          const tile = m.data[2 * size + y * m.width + x];
          if (tile === 176) {
            expect(m.data[2 * size + y * m.width + x + 1]).toBe(177);
            expect(m.data[2 * size + (y + 1) * m.width + x]).toBe(184);
            expect(m.data[2 * size + (y + 1) * m.width + x + 1]).toBe(185);
            trees++;
          }
          if (tile === 157)
            expect(m.data[2 * size + (y + 1) * m.width + x]).toBe(165);
        }
      expect(trees).toBeGreaterThan(20);
    }
  });
  it("blocks every visible inn wall and keeps merchants off furniture", () => {
    const m = map(1);
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const tile = m.data[y * m.width + x],
          region = m.data[(5 * m.height + y) * m.width + x];
        if (tile >= 5888 || x <= 1 || x >= 23)
          expect(region, `Solid wall ${x},${y}`).toBe(255);
      }
    for (const e of m.events)
      if (e && /Nessa|Elowen|Rowan|Vesper|Pip/.test(e.name)) {
        expect(m.data[(2 * m.height + e.y) * m.width + e.x], e.name).toBe(0);
      }
    expect(m.events.find((e) => e?.name === "Road to clearing")?.x).toBe(
      m.events.find((e) => e?.name.startsWith("Nessa"))?.x,
    );
  });
  it("connects the bedroom doorway, every shop counter and the south exit", () => {
    const m = map(1),
      r = reachable(m, 4, 7);
    for (const [x, y] of [
      [6, 10],
      [12, 9],
      [4, 15],
      [19, 15],
      [20, 9],
      [16, 10],
      [12, 19],
    ])
      expect(r.has(`${x},${y}`), `Inn ${x},${y}`).toBe(true);
    expect(m.data[10 * m.width + 6]).toBe(1553);
  });
  for (let id = 2; id <= 5; id++)
    it(`map ${id} connects its entrance, exits and encounter events`, () => {
      const m = map(id),
        r = reachable(
          m,
          id === 2 ? 7 : id < 5 ? 17 : 12,
          id === 2 ? 12 : id < 5 ? 36 : 20,
        );
      for (const e of m.events.filter(Boolean) as NonNullable<
        MapData["events"][number]
      >[])
        if (e.name.startsWith("Road") || e.note.startsWith("encounter:"))
          expect(r.has(`${e.x},${e.y}`), e.name).toBe(true);
    });
  it("keeps the fairy lake solid and allows the hero to reach its shore", () => {
    const m = map(2),
      r = reachable(m, 7, 12);
    expect(r.has("11,4")).toBe(true);
    expect(r.has("8,4")).toBe(false);
    expect(r.has("6,2")).toBe(false);
  });
});
