import { z } from "zod";
import {
  classSchema,
  enemies,
  encounterLocations,
  type ClassId,
} from "./catalog";
import type { GameState } from "./types";
import { initialState, reduceIntent } from "./engine";
const counter = z.number().int().nonnegative().max(10000);
const placeSchema = z.enum(["inn", "clearing", "forest1", "forest2", "shrine"]);
const practiceSnapshotSchema = z
  .object({
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    state: z
      .object({
        rulesVersion: z.literal(5),
        mode: z.literal("practice"),
        classId: classSchema,
        phase: z.enum(["town", "trail", "combat", "victory", "defeat"]),
        location: placeSchema,
        hp: counter,
        maxHp: counter.positive(),
        mp: counter,
        maxMp: counter,
        gold: counter,
        potions: counter.max(5),
        ethers: counter.max(3),
        weapon: z.boolean(),
        armor: z.boolean(),
        spells: z.array(z.enum(["spark", "mend"])).max(2),
        purchased: z
          .array(
            z.enum(["potion", "ether", "weapon", "armor", "spark", "mend"]),
          )
          .max(6),
        visited: z
          .array(z.enum(["inn", "item", "weapon", "armor", "magic"]))
          .max(5),
        encounter: counter.max(5),
        enemyHp: counter,
        turn: counter,
        encounters: z
          .array(counter.max(enemies.length - 1))
          .length(encounterLocations.length),
        cleared: z.array(counter.max(5)).max(6),
        curse: z.boolean(),
        dancerDone: z.boolean(),
        fairyDone: z.boolean(),
        dancerOutcome: z.enum(["none", "inspired", "drained", "slapped"]),
        fairyOutcome: z.enum(["none", "wild", "toad"]),
        boon: z.enum(["none", "inspired", "wild"]),
        demo: z.boolean(),
        clueRead: z.boolean(),
        shortcutOpened: z.boolean(),
        runeSolved: z.boolean(),
        restored: z.array(placeSchema).max(5),
        seed: z.number().int().nonnegative().max(0xffffffff),
        practiceBalance: counter.max(32),
        spent: counter.max(30),
        refunded: counter.max(30),
        bonus: counter.max(2),
        ledger: z
          .array(
            z
              .object({ label: z.string().max(160), amount: counter.max(30) })
              .strict(),
          )
          .max(30),
        log: z.array(z.string().max(600)).max(8),
      })
      .strict()
      .refine(
        (state) =>
          state.hp <= state.maxHp &&
          state.mp <= state.maxMp &&
          state.refunded <= state.spent &&
          state.practiceBalance + state.spent - state.refunded - state.bonus ===
            30 &&
          (state.phase === "victory" || state.bonus === 0) &&
          state.ledger.reduce((total, entry) => total + entry.amount, 0) ===
            state.spent,
      ),
  })
  .strict();

// Local saves are untrusted convenience data and never establish paid eligibility.
export function readPracticeSnapshot(
  value: unknown,
): { state: GameState; version: number } | null {
  const parsed = practiceSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export const demoScenarios = [
  "inspired",
  "drained",
  "slapped",
  "wild",
  "toad",
] as const;
export type DemoScenario = (typeof demoScenarios)[number];
export function practiceDemo(
  classId: ClassId,
  scenario: DemoScenario,
): GameState {
  if (!demoScenarios.includes(scenario))
    throw new Error("Unknown practice demonstration.");
  const fairy = scenario === "wild" || scenario === "toad";
  for (let seed = 0; seed < 10000; seed++) {
    const state = initialState(classId, false, { mode: "practice", seed });
    if (fairy) {
      state.location = "clearing";
      state.phase = "trail";
    }
    const outcome = reduceIntent(state, { type: fairy ? "fairy" : "dancer" });
    if ((fairy ? outcome.fairyOutcome : outcome.dancerOutcome) === scenario) {
      state.demo = true;
      state.log.push(
        "LOCAL DEMO · selected outcome; no paid round or GLOW reward.",
      );
      return state;
    }
  }
  throw new Error("No matching demonstration seed.");
}
