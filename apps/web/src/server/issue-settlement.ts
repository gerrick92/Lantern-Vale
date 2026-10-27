import "server-only";
import { isDeepStrictEqual } from "node:util";
import { hashTypedData, isAddressEqual, type Hex } from "viem";
import { settlementAbi } from "@/lib/settlement";
import { adminDb } from "./auth";
import { chainClient } from "./blockchain";
import { prepareSettlement } from "./prepare-settlement";
import {
  serializeResult,
  signSettlement,
  verifyResultSignature,
} from "./settlement-signer";
import type { RoundRow } from "./rounds";
import { ApiError } from "./http";
import { retainGameplay } from "./game-recovery";

export async function issueSettlement(round: RoundRow) {
  await retainGameplay(round.user_id);
  const prepared = await prepareSettlement(round);
  const rpc = chainClient();
  const signer = await rpc.readContract({
    address: prepared.domain.verifyingContract,
    abi: settlementAbi,
    functionName: "signer",
  });
  const db = adminDb();
  const cached = await db
    .from("game_settlement_results")
    .select("signer,result,signature,digest")
    .eq("round_id", round.id)
    .maybeSingle();
  if (cached.error)
    throw new ApiError(
      503,
      "Saved settlement results are unavailable. Retry later.",
    );
  const saved = cached.data;
  if (saved && isAddressEqual(saved.signer, signer)) {
    try {
      const message = saved.result.message;
      const candidate = {
        ...prepared,
        message: { ...prepared.message, deadline: BigInt(message.deadline) },
      };
      const wire = serializeResult(candidate);
      if (
        isDeepStrictEqual(wire, saved.result) &&
        candidate.message.deadline >= prepared.message.deadline - 3480n &&
        saved.digest === hashTypedData(candidate)
      ) {
        await verifyResultSignature(candidate, saved.signature as Hex, signer);
        return { ...wire, signature: saved.signature as Hex };
      }
    } catch {
      /* Reverify and issue a fresh signature after expiry or signer rotation. */
    }
  }
  const signature = await signSettlement(prepared, signer);
  if (
    !isAddressEqual(
      await rpc.readContract({
        address: prepared.domain.verifyingContract,
        abi: settlementAbi,
        functionName: "signer",
      }),
      signer,
    )
  )
    throw new ApiError(409, "The signer changed. Refresh the saved result.");
  const result = serializeResult(prepared);
  const { error } = await db.from("game_settlement_results").upsert({
    round_id: round.id,
    signer: signer.toLowerCase(),
    digest: hashTypedData(prepared),
    result,
    signature: signature.toLowerCase(),
    updated_at: new Date().toISOString(),
  });
  if (error)
    throw new ApiError(
      503,
      "The verified result could not be saved. Retry; no new entry payment is needed.",
    );
  await retainGameplay(round.user_id);
  return { ...result, signature };
}
