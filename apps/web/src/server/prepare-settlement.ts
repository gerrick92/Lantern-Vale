import "server-only";
import { isAddressEqual } from "viem";
import { adminDb } from "./auth";
import { chainClient } from "./blockchain";
import { ApiError } from "./http";
import type { RoundRow } from "./rounds";
import {
  verifySettlementPayment,
  type SettlementPayment,
} from "./settlement-payments";
import { settlementResult } from "./settlement-result";
import { settlementAbi } from "@/lib/settlement";
import { verifyRoundRandomness } from "./round-randomness";

export async function prepareSettlement(round: RoundRow) {
  if (
    round.economy_version !== "settlement-v1" ||
    round.state.mode !== "paid" ||
    !["victory", "defeat"].includes(round.state.phase)
  )
    throw new ApiError(
      409,
      "Complete this server-owned GLOW adventure before settlement.",
    );
  const db = adminDb();
  const payments: SettlementPayment[] = [];
  // Recheck every payment against canonical chain data, including its original block.
  // Pagination does not impose a gameplay spending cap.
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await db
      .from("settlement_payments")
      .select("transaction_hash,block_hash,item,randomness_proof")
      .eq("round_id", round.id)
      .order("total_deposited")
      .range(offset, offset + 199);
    if (error || !data)
      throw new ApiError(503, "Payment reconciliation is unavailable.");
    for (const row of data) {
      const payment = await verifySettlementPayment(
        row.transaction_hash,
        round.wallet_address,
        row.item === null
          ? undefined
          : { roundId: BigInt(round.contract_round_id), item: row.item },
      );
      if (payment.blockHash !== row.block_hash)
        throw new ApiError(
          409,
          "A payment block changed. Reconciliation is required.",
        );
      if (row.randomness_proof) payment.randomnessProof = row.randomness_proof;
      payments.push(payment);
    }
    if (data.length < 200) break;
  }
  if (
    !payments.length ||
    payments[0].hash !== round.entry_tx_hash ||
    payments[0].blockHash !== round.entry_block_hash
  )
    throw new ApiError(
      409,
      "The entry receipt does not match the deposit ledger.",
    );
  await verifyRoundRandomness(round.state, payments);
  const contract = payments[0].contract;
  const rpc = chainClient();
  const [chainRound, block] = await Promise.all([
    rpc.readContract({
      address: contract,
      abi: settlementAbi,
      functionName: "rounds",
      args: [BigInt(round.contract_round_id)],
    }),
    rpc.getBlock(),
  ]);
  const result = settlementResult(
    round.state,
    round.wallet_address,
    contract,
    BigInt(round.contract_round_id),
    payments,
    block.timestamp + 3600n,
  );
  if (
    !isAddressEqual(chainRound[0], round.wallet_address) ||
    chainRound[1] !== result.message.deposited ||
    chainRound[3]
  )
    throw new ApiError(
      409,
      "The escrow is already settled or has unreconciled payments.",
    );
  return result;
}
