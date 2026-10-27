import { describe, it, expect } from "vitest";
import {
  classes,
  classSpells,
  enemyAction,
  currentEnemy,
  classIds,
  initialState,
  practiceDemo,
  demoScenarios,
  shopItems,
  reduceIntent,
  intentSchema,
  encounterLocations,
  roads,
  isBoss,
  isPaidVictory,
  readPracticeSnapshot,
  type GameState,
  type Intent,
} from "../../game/rules";
export function nextAction(s: GameState): Intent {
  if (s.phase === "combat")
    return isBoss(s) && s.turn % 3 === 2
      ? { type: "guard" }
      : s.hp < s.maxHp * 0.45 && s.potions > 0
        ? { type: "potion" }
        : s.mp >= 6
          ? { type: "skill" }
          : { type: "attack" };
  const slot = encounterLocations.findIndex(
    (p, i) => p === s.location && !s.cleared.includes(i),
  );
  return slot >= 0
    ? { type: "encounter", slot }
    : { type: "move", destination: roads[roads.indexOf(s.location) + 1] };
}
function prepare(s: GameState) {
  s = reduceIntent(s, { type: "visit", place: "inn" });
  s = reduceIntent(s, { type: "visit", place: "armor" });
  return reduceIntent(
    s,
    { type: "buy", item: "armor" },
    s.mode === "paid" ? 1 : undefined,
  );
}
function finish(state: GameState) {
  let s = state;
  for (let i = 0; i < 180 && !["victory", "defeat"].includes(s.phase); i++) {
    s = reduceIntent(s, nextAction(s));
    if (s.mode === "practice")
      expect(readPracticeSnapshot({ state: s, version: i + 1 })?.state).toEqual(
        s,
      );
  }
  return s;
}
describe("Mosslight shared adventure rules", () => {
  it("gives every class stronger skills and two useful, correctly charged spell choices", () => {
    const names = new Set<string>();
    for (const classId of classIds) {
      let s = initialState(classId, false, { mode: "practice" });
      for (const destination of [
        "clearing",
        "forest1",
        "forest2",
        "shrine",
      ] as const)
        s = reduceIntent(s, { type: "move", destination });
      s = reduceIntent(s, { type: "encounter", slot: 5 });
      const attack = reduceIntent(s, { type: "attack" });
      const skill = reduceIntent(s, { type: "skill" });
      expect(s.enemyHp - skill.enemyHp).toBeGreaterThan(
        (s.enemyHp - attack.enemyHp) * 1.5,
      );
      expect(skill.mp).toBe(s.mp - 6);
      for (const spell of ["spark", "mend"] as const) {
        const definition = classSpells[classId][spell];
        names.add(definition.name);
        const before = { ...s, hp: 30, spells: [spell] };
        const after = reduceIntent(before, { type: "magic", spell });
        expect(after.mp).toBe(before.mp - 8);
        expect(after.enemyHp).toBe(before.enemyHp - definition.damage);
        const retaliation = enemyAction(before);
        const hit = Math.max(
          1,
          currentEnemy(before).attack +
            retaliation.bonus -
            classes[classId].defense -
            (definition.ward ? 22 : 0),
        );
        expect(after.hp).toBe(
          Math.max(
            0,
            Math.min(before.maxHp, before.hp + definition.healing) - hit,
          ),
        );
        expect(after.turn).toBe(before.turn + 1);
      }
    }
    expect(names.size).toBe(12);
  });
  it("telegraphs enemy specials and guarding reduces their actual damage", () => {
    let s = initialState("warrior", false, { mode: "practice" });
    s = reduceIntent(s, { type: "move", destination: "clearing" });
    s = reduceIntent(s, { type: "move", destination: "forest1" });
    s = reduceIntent(s, { type: "encounter", slot: 0 });
    s.turn = 1;
    const warned = reduceIntent(s, { type: "guard" });
    expect(warned.log.at(-1)).toContain("is coming");
    expect(enemyAction(warned).special).toBe(true);
    const guarded = reduceIntent(warned, { type: "guard" });
    expect(
      guarded.log.some((line) =>
        line.includes(`uses ${enemyAction(warned).name}:`),
      ),
    ).toBe(true);
    expect(warned.hp - guarded.hp).toBeLessThanOrEqual(3);
  });
  it("excludes practice victories from reward eligibility and requires a finished boss", () => {
    const won = finish(prepare(initialState("warrior", false)));
    expect(isPaidVictory(won)).toBe(true);
    expect(isPaidVictory({ ...won, mode: "practice" })).toBe(false);
    expect(isPaidVictory({ ...won, cleared: [] })).toBe(false);
    expect(isPaidVictory({ ...won, enemyHp: 1 })).toBe(false);
  });
  it("ends a natural combat defeat without refunding practice spending", () => {
    let s = prepare(initialState("warrior", false, { mode: "practice" }));
    s = reduceIntent(s, { type: "move", destination: "clearing" });
    s = reduceIntent(s, { type: "move", destination: "forest1" });
    s = reduceIntent(s, { type: "encounter", slot: 0 });
    while (s.phase === "combat") s = reduceIntent(s, { type: "guard" });
    expect(s.phase).toBe("defeat");
    expect(s.refunded).toBe(0);
    expect(s.practiceBalance).toBe(28);
  });
  for (const classId of classIds) {
    it(`${classId} completes the server-owned paid route`, () => {
      const s = finish(prepare(initialState(classId, false)));
      expect(s.phase).toBe("victory");
      expect(s.cleared).toContain(5);
      expect(s.refunded).toBe(0);
    });
    it(`${classId} can win varied local runs and receive exactly one practice refund`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const s = finish(
          prepare(initialState(classId, false, { mode: "practice", seed })),
        );
        expect(s.phase, `seed ${seed}`).toBe("victory");
        expect(s.practiceBalance).toBe(32);
        expect(s.bonus).toBe(2);
        expect(s.refunded).toBe(s.spent);
        expect(() => reduceIntent(s, { type: "attack" })).toThrow("ended");
      }
    });
  }
  it("has six immutable class choices and exposes varied creatures and all three bosses", () => {
    const bosses = new Set<number>(),
      schedules = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const s = initialState("warrior", false, { mode: "practice", seed });
      bosses.add(s.encounters[5]);
      schedules.add(s.encounters.join(","));
      expect(s.hp).toBe(classes.warrior.hp);
    }
    expect(bosses.size).toBe(3);
    expect(schedules.size).toBeGreaterThan(10);
    expect(classIds).toHaveLength(6);
    expect(
      intentSchema.safeParse({ type: "class", classId: "thief" }).success,
    ).toBe(false);
  });
  it("rejects client victory, prices, inventory, seeds and health", () => {
    for (const value of [
      { type: "win", bossDead: true },
      { type: "attack", hp: 999 },
      { type: "buy", item: "weapon", price: 0 },
      { type: "encounter", slot: 5, seed: 0 },
      { type: "move", destination: "shrine", classId: "warrior" },
    ])
      expect(intentSchema.safeParse(value).success).toBe(false);
  });
  it("enforces connected roads while allowing creature bypasses, and never mutates earlier snapshots", () => {
    const start = initialState("warrior", false);
    expect(
      reduceIntent(start, { type: "move", destination: "clearing" }).location,
    ).toBe("clearing");
    let s = reduceIntent(start, { type: "visit", place: "inn" });
    expect(start.visited).toEqual([]);
    expect(() =>
      reduceIntent(s, { type: "move", destination: "shrine" }),
    ).toThrow("connected");
    s = reduceIntent(s, { type: "move", destination: "clearing" });
    s = reduceIntent(s, { type: "move", destination: "forest1" });
    expect(
      reduceIntent(s, { type: "move", destination: "forest2" }).location,
    ).toBe("forest2");
    expect(() => reduceIntent(s, { type: "encounter", slot: 5 })).toThrow(
      "unavailable",
    );
    s = reduceIntent(s, { type: "encounter", slot: 0 });
    expect(() =>
      reduceIntent(s, { type: "move", destination: "clearing" }),
    ).toThrow("battle");
  });
  it("weakens a cursed hero without blocking travel and charges one cure", () => {
    let s = practiceDemo("ranger", "toad");
    s = reduceIntent(s, { type: "fairy" });
    expect(s.curse).toBe(true);
    expect(s.hp).toBe(8);
    expect(s.mp).toBe(0);
    expect(
      reduceIntent(s, { type: "move", destination: "forest1" }).curse,
    ).toBe(true);
    s = reduceIntent(s, { type: "move", destination: "inn" });
    s = reduceIntent(s, { type: "visit", place: "inn" });
    const balance = s.practiceBalance;
    s = reduceIntent(s, { type: "rest" });
    expect(s.practiceBalance).toBe(balance - 1);
    expect(s.curse).toBe(false);
    expect(s.hp).toBe(s.maxHp);
    expect(() => reduceIntent(s, { type: "rest" })).toThrow("already");
  });
  it("charges the dancer once and records the loss without taking unspent funds on defeat", () => {
    let s = initialState("thief", false, { mode: "practice" });
    s = reduceIntent(s, { type: "dancer" });
    expect(s.spent).toBe(2);
    expect(s.practiceBalance).toBe(28);
    expect(() => reduceIntent(s, { type: "dancer" })).toThrow();
    s = reduceIntent(s, { type: "abandon" });
    expect(s.practiceBalance).toBe(28);
    expect(s.refunded).toBe(0);
    expect(() => reduceIntent(s, { type: "rest" })).toThrow("ended");
  });
  it("allows discovering the shortcut without a mandatory clue and still requires the boss", () => {
    let s = prepare(initialState("warrior", false, { mode: "practice" }));
    s = reduceIntent(s, { type: "move", destination: "clearing" });
    s = reduceIntent(s, { type: "move", destination: "forest1" });
    expect(reduceIntent(s, { type: "shortcut" }).shortcutOpened).toBe(true);
    s = reduceIntent(s, { type: "clue" });
    s = reduceIntent(s, { type: "shortcut" });
    s = reduceIntent(s, { type: "move", destination: "forest2" });
    expect(s.cleared).toEqual([]);
    const won = finish(s);
    expect(won.phase).toBe("victory");
    expect(won.cleared).not.toContain(0);
    expect(won.cleared).toContain(5);
    expect(won.bonus).toBe(1);
    expect(won.practiceBalance).toBe(31);
  });
  it("enforces vendor, money, carrying limits and one-time spell/equipment ownership", () => {
    let s = initialState("black_mage", false, { mode: "practice" });
    expect(() => reduceIntent(s, { type: "buy", item: "armor" })).toThrow(
      "counter",
    );
    s = reduceIntent(s, { type: "visit", place: "magic" });
    expect(() => reduceIntent(s, { type: "buy", item: "spark" })).toThrow(
      "already",
    );
    s = reduceIntent(s, { type: "buy", item: "mend" });
    expect(s.spells).toContain("mend");
    s = reduceIntent(s, { type: "visit", place: "item" });
    s = reduceIntent(s, { type: "buy", item: "potion" });
    expect(() => reduceIntent(s, { type: "buy", item: "potion" })).toThrow(
      "sold out",
    );
    s.practiceBalance = 0;
    expect(() => reduceIntent(s, { type: "buy", item: "ether" })).toThrow(
      "Not enough",
    );
  });
  it("rewards the listening-stone puzzle once and permits mistakes without softlocking", () => {
    let s = prepare(initialState("warrior", false, { mode: "practice" }));
    while (s.location !== "forest2") s = reduceIntent(s, nextAction(s));
    s = reduceIntent(s, { type: "puzzle", answer: "sun" });
    expect(s.runeSolved).toBe(false);
    s = reduceIntent(s, { type: "puzzle", answer: "moon" });
    expect(s.runeSolved).toBe(true);
    expect(() => reduceIntent(s, { type: "puzzle", answer: "moon" })).toThrow(
      "quiet",
    );
  });
  it("keeps paid encounter schedules independent of browser seed and kit derives on the server", () => {
    expect(initialState("warrior", false, { seed: 888 }).encounters).toEqual(
      initialState("warrior", false, { seed: 123 }).encounters,
    );
    expect(initialState("warrior", true).maxHp).toBe(classes.warrior.hp + 8);
  });
});

describe("Practice encounters and spending", () => {
  it("prices every purchase at one token", () => {
    expect(Object.values(shopItems).every((item) => item.cost === 1)).toBe(
      true,
    );
  });
  for (const outcome of demoScenarios)
    it("demonstrates " + outcome + " without granting paid eligibility", () => {
      const start = practiceDemo("warrior", outcome);
      const type = ["toad", "wild"].includes(outcome) ? "fairy" : "dancer";
      const result = reduceIntent(start, { type });
      expect(
        type === "fairy" ? result.fairyOutcome : result.dancerOutcome,
      ).toBe(outcome);
      expect(result.spent).toBe(2);
      expect(result.practiceBalance).toBe(28);
      expect(result.demo).toBe(true);
      expect(reduceIntent(start, { type })).toEqual(result);
      expect(() => reduceIntent(result, { type })).toThrow();
      expect(() => reduceIntent({ ...start, mode: "paid" }, { type })).toThrow(
        "verified randomness",
      );
      const won = finish(prepare(initialState("warrior", false)));
      expect(isPaidVictory({ ...won, demo: true })).toBe(false);
    });
  it("permits healing again after new damage without a round spending cap", () => {
    let s = initialState("warrior", false, { mode: "practice" });
    s = reduceIntent(s, { type: "visit", place: "inn" });
    for (let i = 0; i < 11; i++) {
      s = reduceIntent({ ...s, hp: 1 }, { type: "rest" });
      expect(s.hp).toBe(s.maxHp);
    }
    expect(s.spent).toBe(12);
    expect(s.practiceBalance).toBe(18);
  });
});
