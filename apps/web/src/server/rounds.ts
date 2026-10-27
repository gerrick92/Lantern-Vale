import "server-only";
import type { GameState } from "@game/rules";
import { adminDb } from "./auth";
import { ApiError } from "./http";
import { retainGameplay } from "./game-recovery";
export type RoundRow = {
  id: string;
  user_id: string;
  wallet_address: `0x${string}`;
  gateway_address: `0x${string}`;
  contract_round_id: string;
  entry_tx_hash: `0x${string}`;
  entry_block_hash: `0x${string}`;
  state: GameState;
  version: number;
  created_at: string;
  class: string;
  economy_version: "legacy" | "settlement-v1";
};
export async function ownedRound(id: string, userId: string) {
  const { data, error } = await adminDb()
    .from("game_rounds")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(503, "Adventure state is unavailable.");
  if (!data) throw new ApiError(404, "Adventure not found.");
  await retainGameplay(userId);
  return data as RoundRow;
}
