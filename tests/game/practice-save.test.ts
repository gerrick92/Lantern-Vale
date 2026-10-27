import { expect, it } from "vitest";
import {
  classIds,
  initialState,
  readPracticeSnapshot,
  reduceIntent,
} from "../../game/rules";

it("loads valid practice progress for every class without accepting paid state", () => {
  for (const classId of classIds) {
    const state = reduceIntent(
      initialState(classId, false, { mode: "practice", seed: 0xffffffff }),
      { type: "visit", place: "inn" },
    );
    const saved = { state, version: 1 };
    expect(readPracticeSnapshot(JSON.parse(JSON.stringify(saved)))).toEqual(
      saved,
    );
    expect(
      readPracticeSnapshot({ ...saved, state: { ...state, mode: "paid" } }),
    ).toBeNull();
  }
});

it("rejects truncated, incompatible and corrupt saves instead of crashing the renderer", () => {
  const state = initialState("warrior", false, { mode: "practice" });
  for (const value of [
    null,
    [],
    { state: { rulesVersion: 3, mode: "practice", classId: "warrior" } },
    { state, version: -1 },
    { state: { ...state, rulesVersion: 2 }, version: 0 },
    { state: { ...state, rulesVersion: 4 }, version: 0 },
    { state: { ...state, location: "missing-map" }, version: 0 },
    { state: { ...state, encounters: [99] }, version: 0 },
    { state: { ...state, log: null }, version: 0 },
    { state: { ...state, hp: Infinity }, version: 0 },
    { state: { ...state, spent: 5 }, version: 0 },
  ]) {
    expect(readPracticeSnapshot(value)).toBeNull();
  }
});
