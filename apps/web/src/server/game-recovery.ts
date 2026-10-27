import "server-only";
import { createClient } from "@supabase/supabase-js";
import { adminDb } from "./auth";
import { ApiError } from "./http";
import {
  retainGameActions,
  type RecoveryStore,
} from "./game-recovery-protocol";

export async function retainGameplay(userId: string) {
  const database = adminDb();
  try {
    const { data, error } = await database.rpc("read_game_recovery_batch", {
      p_user: userId,
    });
    if (error || !Array.isArray(data?.events)) throw new Error();
    if (!data.events.length) return;
    const source = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    const target = new URL(process.env.GAME_RECOVERY_URL || "");
    if (
      target.protocol !== "https:" ||
      !/^[a-z]{20}\.supabase\.co$/.test(target.hostname) ||
      target.origin === source.origin ||
      target.pathname !== "/" ||
      target.search ||
      target.hash ||
      target.username ||
      target.password
    )
      throw new Error();
    const secret = process.env.GAME_RECOVERY_SECRET,
      rawKey = process.env.GAME_RECOVERY_KEY;
    if (!secret || !/^[0-9a-f]{64}$/.test(rawKey || "")) throw new Error();
    const key = Buffer.from(rawKey!, "hex");
    const remote = createClient(target.origin, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          }),
      },
    });
    const bucket = remote.storage.from("game-recovery");
    const store: RecoveryStore = {
      async put(path, bytes) {
        const result = await bucket.upload(path, bytes, {
          upsert: false,
          contentType: "application/octet-stream",
        });
        if (
          result.error &&
          !["409", "Duplicate"].includes(String(result.error.statusCode))
        )
          throw new Error();
      },
      async get(path) {
        const result = await bucket.download(path);
        if (
          result.error ||
          !result.data ||
          result.data.size > 8 * 1024 * 1024 + 36
        )
          throw new Error();
        return new Uint8Array(await result.data.arrayBuffer());
      },
    };
    let initial: unknown[] | undefined = data.events;
    try {
      await retainGameActions({
        project: source.hostname.split(".")[0],
        stream: process.env.GAME_RECOVERY_STREAM || "",
        userId,
        key,
        store,
        database: {
          async read() {
            if (initial) {
              const batch = initial;
              initial = undefined;
              return batch;
            }
            const result = await database.rpc("read_game_recovery_batch", {
              p_user: userId,
            });
            if (result.error || !Array.isArray(result.data?.events))
              throw new Error();
            return result.data.events;
          },
          async acknowledge(first, last) {
            const result = await database.rpc("acknowledge_game_recovery", {
              p_user: userId,
              p_from: first.sequence,
              p_to: last.sequence,
              p_hash: last.hash,
            });
            if (result.error) throw new Error();
          },
        },
      });
    } finally {
      key.fill(0);
    }
  } catch {
    throw new ApiError(
      503,
      "Adventure recovery storage is temporarily unavailable. Retry this action; do not pay again.",
    );
  }
}
