import { expect, it } from "vitest";
import { initialState, practiceChance, reduceIntent } from "../../game/rules";

it("uses the same NPC thresholds in practice and verified GLOW outcomes", () => {
  const totals = { inspired: 0, drained: 0, slapped: 0, wild: 0, toad: 0 };
  for (let roll = 0; roll < 100; roll++) {
    const inn = initialState("warrior", false);
    const forest = reduceIntent(inn, { type: "move", destination: "clearing" });
    const dancer = reduceIntent(inn, { type: "dancer" }, 6, roll).dancerOutcome;
    const fairy = reduceIntent(forest, { type: "fairy" }, 7, roll).fairyOutcome;
    if (dancer !== "none") totals[dancer]++;
    if (fairy !== "none") totals[fairy]++;
  }
  expect(totals).toEqual({
    inspired: 25,
    drained: 25,
    slapped: 50,
    wild: 25,
    toad: 75,
  });
  for (let seed = 0; seed < 100; seed++) {
    const practice = initialState("warrior", false, { mode: "practice", seed });
    const paid = initialState("warrior", false);
    expect(reduceIntent(practice, { type: "dancer" }).dancerOutcome).toBe(
      reduceIntent(
        paid,
        { type: "dancer" },
        6,
        Math.floor(practiceChance(seed, 0x56455350)),
      ).dancerOutcome,
    );
    const a = reduceIntent(practice, { type: "move", destination: "clearing" });
    const b = reduceIntent(paid, { type: "move", destination: "clearing" });
    expect(reduceIntent(a, { type: "fairy" }).fairyOutcome).toBe(
      reduceIntent(
        b,
        { type: "fairy" },
        7,
        Math.floor(practiceChance(seed, 0x46414952)),
      ).fairyOutcome,
    );
  }
});
