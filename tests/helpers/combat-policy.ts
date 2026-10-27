import {
  currentEnemy,
  enemyAction,
  reduceIntent,
  type GameState,
  type Intent,
} from "../../game/rules";

// A disclosed, limited-lookahead test player, not a claim about human win rates.
// It only considers legal combat actions and sees the same telegraphed state.
export function tacticalAction(state: GameState, nonDamagingTurns = 0): Intent {
  const candidates: Intent[] = [
    { type: "attack" },
    { type: "skill" },
    { type: "guard" },
  ];
  if (state.potions && state.hp <= state.maxHp - 45)
    candidates.push({ type: "potion" });
  if (state.ethers && state.mp <= state.maxMp - 20)
    candidates.push({ type: "ether" });
  for (const spell of state.spells) candidates.push({ type: "magic", spell });
  let best: Intent = { type: "attack" },
    highest = -Infinity;
  for (const action of candidates) {
    try {
      const next = reduceIntent(state, action);
      // Break a greedy heal/guard loop after three turns without progress.
      if (nonDamagingTurns >= 3 && next.enemyHp >= state.enemyHp) continue;
      const danger = Math.max(
        1,
        currentEnemy(state).attack + enemyAction(state).bonus,
      );
      const healingWeight =
        state.hp < danger * 2 ? 3 : state.hp < state.maxHp / 2 ? 1.4 : 0.5;
      const score =
        next.phase === "defeat"
          ? -10000
          : next.phase !== "combat"
            ? 10000 + next.hp
            : state.enemyHp -
              next.enemyHp +
              (next.hp - state.hp) * healingWeight +
              (next.mp - state.mp) * 0.45 -
              (action.type === "potion" || action.type === "ether" ? 8 : 0);
      if (score > highest) {
        highest = score;
        best = action;
      }
    } catch {
      /* Unavailable resources make an action ineligible. */
    }
  }
  return best;
}
