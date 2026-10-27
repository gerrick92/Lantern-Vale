import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionControls } from "../../../apps/web/src/features/game/action-controls";
import { AdventureStatus } from "../../../apps/web/src/features/game/adventure-status";
import {
  initialState,
  reduceIntent,
  type GameState,
} from "../../../game/rules";

declare global {
  interface Window {
    companionFixture: { set: (state: GameState) => void; get: () => GameState };
  }
}
function Fixture() {
  const [state, setState] = useState(
    initialState("warrior", false, { mode: "practice" }),
  );
  useEffect(() => {
    window.companionFixture = { set: setState, get: () => state };
  }, [state]);
  return (
    <main>
      <h1>Adventure companion</h1>
      <a href="#companion">Skip to available actions</a>
      <section id="companion" tabIndex={-1} aria-label="Adventure actions">
        <AdventureStatus state={state} />
        <ActionControls
          state={state}
          disabled={false}
          onAction={async (intent) =>
            setState((current) => reduceIntent(current, intent))
          }
        />
        <ol aria-label="Adventure events">
          {state.log.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      </section>
      <button type="button">Outside the game</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
