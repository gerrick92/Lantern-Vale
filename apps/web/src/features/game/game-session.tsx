"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaidLobby } from "./paid-lobby";
import { GamePlayer } from "./player";

export function GameSession({
  initialRoundId,
  enabled,
}: {
  initialRoundId?: string;
  enabled: boolean;
}) {
  const [roundId, setRoundId] = useState(initialRoundId);
  const [fullscreen, setFullscreen] = useState(false);
  const [companion, setCompanion] = useState(false);
  const [message, setMessage] = useState("");
  const screen = useRef<HTMLDivElement>(null);
  const showGame = useCallback(() => setCompanion(false), []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await screen.current?.requestFullscreen();
    } catch {
      setMessage("Fullscreen is unavailable in this browser.");
    }
  }, []);
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === screen.current);
    function receive(event: MessageEvent) {
      const frame = screen.current?.querySelector("iframe");
      if (
        event.origin === location.origin &&
        event.source === frame?.contentWindow &&
        event.data?.type === "mosslight.fullscreen"
      )
        void toggleFullscreen();
    }
    document.addEventListener("fullscreenchange", changed);
    addEventListener("message", receive);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      removeEventListener("message", receive);
    };
  }, [toggleFullscreen]);
  function started(id: string) {
    setRoundId(id);
    // Keep the fullscreen element mounted while switching from class selection to play.
    history.replaceState(
      null,
      "",
      `/adventure/play?round=${encodeURIComponent(id)}`,
    );
  }
  return (
    <div ref={screen} className="glow-session" data-companion={companion}>
      <div className="actions glow-toolbar">
        <button className="secondary" onClick={() => void toggleFullscreen()}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen game"}
        </button>
        {fullscreen && (
          <button
            className="secondary"
            aria-pressed={companion}
            onClick={() => setCompanion(!companion)}
          >
            {companion ? "Show game" : "Show companion"}
          </button>
        )}
        {message && <span role="status">{message}</span>}
      </div>
      <div className="glow-session-content">
        {roundId ? (
          <GamePlayer
            roundId={roundId}
            enabled={enabled}
            onPaymentOpen={showGame}
          />
        ) : (
          <PaidLobby enabled={enabled} onStarted={started} />
        )}
      </div>
    </div>
  );
}
