"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GameState } from "@game/rules";
export function RecentRounds() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["adventure-history"],
    queryFn: () =>
      api<{
        rounds: {
          id: string;
          class: string;
          state: GameState;
          created_at: string;
        }[];
      }>("/api/rounds"),
  });
  return (
    <section className="panel" aria-labelledby="game-history-title">
      <h2 id="game-history-title">History</h2>
      <p className="muted">
        Your latest GLOW adventures. Test games are not saved here.
      </p>
      {isPending && <p role="status">Loading adventure history…</p>}
      {isError && (
        <p role="alert">History could not be loaded. Please try again.</p>
      )}
      {data && !data.rounds.length && <p>No GLOW adventures yet.</p>}
      {!!data?.rounds.length && (
        <ul className="game-history-list">
          {data.rounds.map((round) => (
            <li key={round.id}>
              <strong>{round.class.replaceAll("_", " ")}</strong>
              <span>
                {round.state.phase === "victory"
                  ? "Victory"
                  : round.state.phase === "defeat"
                    ? "Defeat"
                    : "Unfinished"}
              </span>
              <time dateTime={round.created_at}>
                {new Date(round.created_at).toLocaleDateString("en-GB")}
              </time>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="secondary"
        disabled={isFetching}
        onClick={() => void refetch()}
      >
        {isFetching ? "Refreshing…" : "Refresh history"}
      </button>
    </section>
  );
}
