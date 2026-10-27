import { randomBytes, randomUUID } from "node:crypto";
import { retainGameActions } from "../../apps/web/src/server/game-recovery-protocol";
import type { localDatabase } from "./local-database";

// Exercise the real journal protocol without hosted services or credentials.
export function memoryGameRecovery(
  database: () => Awaited<ReturnType<typeof localDatabase>>["api"],
) {
  const objects = new Map<string, Uint8Array>();
  const key = randomBytes(32),
    stream = randomUUID();
  return async (userId: string) =>
    retainGameActions({
      userId,
      project: "abcdefghijklmnopqrst",
      stream,
      key,
      store: {
        async put(path, bytes) {
          if (!objects.has(path)) objects.set(path, bytes);
        },
        async get(path) {
          const bytes = objects.get(path);
          if (!bytes) throw new Error("Missing recovery object");
          return bytes;
        },
      },
      database: {
        async read() {
          const result = await database().rpc("read_game_recovery_batch", {
            p_user: userId,
          });
          if (result.error) throw result.error;
          return (result.data as { events: unknown[] }).events;
        },
        async acknowledge(first, last) {
          const result = await database().rpc("acknowledge_game_recovery", {
            p_user: userId,
            p_from: first.sequence,
            p_to: last.sequence,
            p_hash: last.hash,
          });
          if (result.error) throw result.error;
        },
      },
    });
}
