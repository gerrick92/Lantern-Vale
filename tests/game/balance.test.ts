import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  classIds,
  encounterPools,
  encounterLocations,
  initialState,
  paymentItem,
  reduceIntent,
  roads,
  shopItems,
  type ClassId,
  type Intent,
} from "../../game/rules";
import { tacticalAction } from "../helpers/combat-policy";

type Loadout = "starting" | "stocked";
type Scene =
  "none" | "inspired" | "drained" | "slapped" | "wild" | "toad" | "cured";
const encounters = encounterPools.reduce<number[][]>(
  (rows, pool) => rows.flatMap((row) => pool.map((enemy) => [...row, enemy])),
  [[]],
);
function play(
  classId: ClassId,
  selection: number[],
  loadout: Loadout,
  scene: Scene,
  fullClear: boolean,
) {
  let state = initialState(classId, false, { verifiedEncounters: selection });
  let turns = 0,
    nonDamagingTurns = 0;
  const act = (intent: Intent, chance?: number) => {
    state = reduceIntent(state, intent, paymentItem(intent), chance);
  };
  if (loadout === "stocked") {
    for (const item of Object.keys(shopItems) as (keyof typeof shopItems)[]) {
      if ((item === "spark" || item === "mend") && state.spells.includes(item))
        continue;
      act({ type: "visit", place: shopItems[item].vendor });
      act({ type: "buy", item });
    }
  }
  if (["inspired", "drained", "slapped"].includes(scene))
    act(
      { type: "dancer" },
      scene === "inspired" ? 0 : scene === "drained" ? 25 : 50,
    );
  act({ type: "move", destination: "clearing" });
  if (["wild", "toad", "cured"].includes(scene))
    act({ type: "fairy" }, scene === "wild" ? 0 : 25);
  if (scene === "cured") {
    act({ type: "move", destination: "inn" });
    act({ type: "visit", place: "inn" });
    act({ type: "rest" });
    act({ type: "move", destination: "clearing" });
  }
  for (
    let actions = 0;
    actions < 300 && !["victory", "defeat"].includes(state.phase);
    actions++
  ) {
    if (state.phase === "combat") {
      const previousHp = state.enemyHp;
      act(tacticalAction(state, nonDamagingTurns));
      turns++;
      nonDamagingTurns =
        state.phase === "combat" && state.enemyHp >= previousHp
          ? nonDamagingTurns + 1
          : 0;
    } else {
      const slot = encounterLocations.findIndex(
        (place, i) =>
          place === state.location &&
          !state.cleared.includes(i) &&
          (fullClear || i === 5),
      );
      act(
        slot >= 0
          ? { type: "encounter", slot }
          : {
              type: "move",
              destination: roads[roads.indexOf(state.location) + 1],
            },
      );
    }
  }
  return { state, turns };
}
type Row = {
  classId: ClassId;
  loadout: Loadout;
  scene: Scene;
  route: string;
  runs: number;
  wins: number;
  minHp: number;
  turns: number;
  maxTurns: number;
};
it("measures every encounter combination and all NPC outcomes without changing reward eligibility", () => {
  const rows: Row[] = [];
  for (const classId of classIds)
    for (const loadout of ["starting", "stocked"] as const)
      for (const scene of [
        "none",
        "inspired",
        "drained",
        "slapped",
        "wild",
        "toad",
        "cured",
      ] as const)
        for (const fullClear of [false, true]) {
          // Baseline: all 324 legal draws. NPC cases: eight forest draws crossed with all three bosses.
          const selections =
            scene === "none"
              ? encounters
              : Array.from(
                  { length: 24 },
                  (_, i) =>
                    encounters[
                      Math.floor((Math.floor(i / 3) * 107) / 7) * 3 + (i % 3)
                    ],
                );
          expect(new Set(selections.map((draw) => draw[5])).size).toBe(3);
          const row: Row = {
            classId,
            loadout,
            scene,
            route: fullClear ? "full-clear" : "boss-only",
            runs: selections.length,
            wins: 0,
            minHp: Infinity,
            turns: 0,
            maxTurns: 0,
          };
          for (const selection of selections) {
            const { state, turns } = play(
              classId,
              selection,
              loadout,
              scene,
              fullClear,
            );
            expect(["victory", "defeat"]).toContain(state.phase);
            expect(state.refunded).toBe(0);
            expect(state.bonus).toBe(0); // Simulation cannot issue a paid reward.
            if (state.phase === "victory") {
              row.wins++;
              row.minHp = Math.min(row.minHp, state.hp);
            }
            row.turns += turns;
            row.maxTurns = Math.max(row.maxTurns, turns);
          }
          rows.push(row);
        }
  mkdirSync("test-results/balance", { recursive: true });
  writeFileSync(
    "test-results/balance/report.json",
    JSON.stringify(
      {
        policy:
          "One-turn tactical lookahead; no mid-route rest, puzzle cache or retreat. Model results, not human win probabilities.",
        encounterCombinations: encounters.length,
        runs: rows.reduce((total, row) => total + row.runs, 0),
        rows,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    "test-results/balance/report.md",
    "# Local combat measurements\n\nModel outcomes, not human win probabilities. Baseline covers every legal encounter combination. Each NPC outcome covers eight forest draws crossed with all three bosses. No mid-route healing, puzzle cache or retreat. Stocked buys each available item once.\n\n| Class | Gear | NPC | Route | Wins / runs | Lowest winning HP | Mean turns |\n|---|---|---|---|---|---|---|\n" +
      rows
        .map(
          (r) =>
            `| ${r.classId} | ${r.loadout} | ${r.scene} | ${r.route} | ${r.wins}/${r.runs} | ${Number.isFinite(r.minHp) ? r.minHp : "—"} | ${(r.turns / r.runs).toFixed(1)} |`,
        )
        .join("\n") +
      "\n",
  );
  for (const classId of classIds)
    expect(
      rows
        .filter(
          (r) =>
            r.classId === classId &&
            r.scene === "none" &&
            r.loadout === "stocked",
        )
        .every((r) => r.wins === r.runs),
      `${classId} has an unwinnable prepared draw under the disclosed policy`,
    ).toBe(true);
}, 120000);
