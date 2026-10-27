"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { ActionControls } from "./action-controls";
import { AdventureStatus } from "./adventure-status";
import {
  questHint,
  demoScenarios,
  type GameState,
  type Intent,
} from "@game/rules";
import { usePreferences } from "@/features/settings/preferences";
export function PracticePlayer({
  developerTools = false,
}: {
  developerTools?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<GameState | null>(null),
    [notice, setNotice] = useState(""),
    [paused, setPaused] = useState(false);
  const [prefs] = usePreferences();
  const send = useCallback(
    () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: "mosslight.practice-preferences",
          paused,
          mute: prefs.mute,
          reduced:
            prefs.reduced ||
            prefs.accessible ||
            matchMedia("(prefers-reduced-motion: reduce)").matches,
        },
        location.origin,
      ),
    [paused, prefs],
  );
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "mosslight.ready") {
        send();
        frame.current?.contentWindow?.postMessage(
          { type: "mosslight.practice-request" },
          location.origin,
        );
      }
      if (
        event.data?.type === "mosslight.practice-state" &&
        event.data.snapshot?.state?.mode === "practice" &&
        event.data.snapshot.state.rulesVersion === 5
      ) {
        setState(event.data.snapshot.state);
        setNotice(event.data.notice || "");
      }
    }
    window.addEventListener("message", receive);
    send();
    return () => window.removeEventListener("message", receive);
  }, [send]);
  async function act(intent: Intent) {
    frame.current?.contentWindow?.postMessage(
      { type: "mosslight.practice-action", intent },
      location.origin,
    );
  }
  return (
    <>
      <div className="actions">
        <button type="button" onClick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void frame.current
              ?.requestFullscreen()
              .catch(() => setNotice("Fullscreen is unavailable."))
          }
        >
          Fullscreen game
        </button>
        <a href="#practice-companion">Skip to accessible companion</a>
      </div>
      <p className="muted">
        Arrow keys or tap to move · Enter or tap to interact · Esc to go back in
        menus. Click inside the game before using the keyboard. Audio follows
        your site settings.
      </p>
      {developerTools && process.env.NODE_ENV === "development" && (
        <details className="panel section" open>
          <summary>Choose a demo scene</summary>
          <p>
            Start a fresh demonstration round with a selected encounter outcome.
            This replaces current practice progress and can never pay GLOW.
          </p>
          <p>
            Vesper: 25% Inspired, 25% drained, 50% slap. Ilyra: 25% woodland
            form, 75% toad. Speak to the character after selecting a scene.
          </p>
          <div className="actions">
            {demoScenarios.map((scenario) => (
              <button
                type="button"
                className="secondary"
                key={scenario}
                disabled={paused}
                onClick={() =>
                  frame.current?.contentWindow?.postMessage(
                    { type: "mosslight.practice-demo", scenario },
                    location.origin,
                  )
                }
              >
                Show {scenario}
              </button>
            ))}
          </div>
        </details>
      )}
      <iframe
        ref={frame}
        className="practice-frame"
        title="Lantern Vale local RPG Maker MZ rehearsal"
        src="/games/mosslight/index.html?practice=1"
        allow="fullscreen"
        onLoad={send}
      />
      <section
        id="practice-companion"
        tabIndex={-1}
        className="panel section"
        aria-label="Practice adventure companion"
      >
        <h2>Adventure companion</h2>
        <p>
          Practice tokens have no value. Each new game starts with 30; entry
          costs 1 after class confirmation. Victory refunds your recorded
          spending once, plus 1 for the boss or 2 for every enemy and the boss.
          Defeat loses spent tokens. Rehearsals are unlimited.
        </p>
        {state ? (
          <>
            {state.demo && (
              <p className="status">
                LOCAL DEMO · selected outcome · no GLOW payout
              </p>
            )}
            <AdventureStatus state={state} />
            <p>
              Practice balance {state.practiceBalance} · Spent {state.spent} ·
              Refunded {state.refunded}
              {state.bonus > 0 && <> · Bonus {state.bonus}</>}
            </p>
            <p>{questHint(state)}</p>
            <ActionControls state={state} disabled={paused} onAction={act} />
            <ol className="quest-log" aria-label="Adventure events">
              {state.log.map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ol>
            <details>
              <summary>Spending record</summary>
              <ul>
                {state.ledger.map((entry, i) => (
                  <li key={i}>
                    {entry.label}: {entry.amount} practice token
                    {entry.amount === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p>
            Choose New Game in the game window. The companion provides the same
            exploration and combat actions with native text controls.
          </p>
        )}
        <p role="status">{notice}</p>
      </section>
    </>
  );
}
