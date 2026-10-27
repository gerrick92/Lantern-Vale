import "server-only";
import { randomBytes } from "node:crypto";
import { isAddressEqual, type Address } from "viem";
import {
  initialState,
  paymentItem,
  reduceIntent,
  type ClassId,
  type Intent,
} from "@game/rules";
import { contracts } from "@/lib/chain";
import { GLOW_PRICE, settlementAbi, settlementClasses } from "@/lib/settlement";
import type { PaymentPlan } from "@/features/game/payment-journal";
import type { RoundRow } from "./rounds";
import { settlementAddress } from "./settlement-payments";
import { chainClient } from "./blockchain";
import { ApiError } from "./http";
import { fetchVerifiedBeacon, quicknet } from "./beacon-randomness";

export async function reviewPayment(
  wallet: Address,
  action:
    | { kind: "entry"; classId: ClassId }
    | {
        kind: "purchase";
        round: RoundRow;
        version: number;
        requestId: string;
        intent: Intent;
      },
): Promise<PaymentPlan> {
  const address = settlementAddress();
  if (!contracts.token || !contracts.faucet)
    throw new ApiError(503, "The token and faucet must be verified first.");
  const rpc = chainClient();
  if ((await rpc.getChainId()) !== 11155111)
    throw new ApiError(503, "The RPC is not on Sepolia.");
  const [token, pool, paused] = await Promise.all([
    rpc.readContract({ address, abi: settlementAbi, functionName: "token" }),
    rpc.readContract({
      address,
      abi: settlementAbi,
      functionName: "recyclingPool",
    }),
    rpc.readContract({ address, abi: settlementAbi, functionName: "paused" }),
  ]);
  if (
    !isAddressEqual(token, contracts.token) ||
    !isAddressEqual(pool, contracts.faucet) ||
    paused
  )
    throw new ApiError(
      503,
      "GLOW payments are paused or the deployment configuration does not match.",
    );
  if (action.kind === "entry") {
    initialState(action.classId, false);
    if (
      (await rpc.readContract({
        address,
        abi: settlementAbi,
        functionName: "availableBonusPool",
      })) <
      2n * GLOW_PRICE
    )
      throw new ApiError(
        409,
        "The bonus reserve cannot support another adventure.",
      );
  } else {
    const { round } = action;
    if (
      !isAddressEqual(round.wallet_address, wallet) ||
      !isAddressEqual(round.gateway_address, address) ||
      round.version !== action.version ||
      round.economy_version !== "settlement-v1"
    )
      throw new ApiError(
        409,
        "Refresh this adventure before reviewing a purchase.",
      );
    const item = paymentItem(action.intent);
    if (item === undefined)
      throw new ApiError(400, "This action does not require payment.");
    // This discarded result validates eligibility only; a future verified draw
    // determines the actual outcome after the canonical payment is mined.
    try {
      reduceIntent(round.state, action.intent, item, 0);
    } catch (error) {
      throw new ApiError(
        409,
        error instanceof Error
          ? error.message
          : "This purchase is unavailable.",
      );
    }
    const escrow = await rpc.readContract({
      address,
      abi: settlementAbi,
      functionName: "rounds",
      args: [BigInt(round.contract_round_id)],
    });
    if (
      !isAddressEqual(escrow[0], wallet) ||
      escrow[1] !== BigInt(round.state.spent) * GLOW_PRICE ||
      escrow[3] ||
      settlementClasses[escrow[4]] !== round.class
    )
      throw new ApiError(
        409,
        "Recover earlier payments before making another purchase.",
      );
  }
  const block = await rpc.getBlock();
  if (
    action.kind === "entry" ||
    ["dancer", "fairy"].includes(action.intent.type)
  ) {
    const latestPublished =
      Number(
        (block.timestamp - BigInt(quicknet.genesis_time)) /
          BigInt(quicknet.period),
      ) + 1;
    await fetchVerifiedBeacon(latestPublished);
  }
  return {
    chainId: 11155111,
    wallet,
    contract: address,
    token: contracts.token,
    paymentId: `0x${randomBytes(32).toString("hex")}`,
    deadline: (block.timestamp + 600n).toString(),
    action:
      action.kind === "entry"
        ? action
        : {
            kind: "purchase",
            roundId: action.round.id,
            contractRoundId: action.round.contract_round_id,
            version: action.version,
            requestId: action.requestId,
            intent: action.intent,
          },
  };
}
