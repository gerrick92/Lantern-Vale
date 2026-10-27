"use client";
import {
  classes,
  currentEnemy,
  enemyAction,
  locations,
  type GameState,
} from "@game/rules";

export function AdventureStatus({ state }: { state: GameState }) {
  const next = state.phase === "combat" ? enemyAction(state) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="adventure-status"
    >
      <p>
        <strong>{classes[state.classId].name}</strong> ·{" "}
        {locations[state.location].name} · HP {state.hp}/{state.maxHp} · MP{" "}
        {state.mp}/{state.maxMp}
      </p>
      {state.phase === "combat" && (
        <p>
          {currentEnemy(state).name}: {state.enemyHp} HP. Next: {next?.name}.
        </p>
      )}
      <p>{state.log.at(-1)}</p>
    </div>
  );
}
