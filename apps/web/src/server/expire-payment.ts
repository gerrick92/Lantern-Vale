import "server-only";
import { type Address, type Hash, isAddressEqual } from "viem";
import type { PaymentPlan } from "@/features/game/payment-journal";
import { settlementAbi } from "@/lib/settlement";
import { settlementAddress } from "./settlement-payments";
import { chainClient } from "./blockchain";
import { ApiError } from "./http";

export async function verifyUnpaidExpiry(plan: PaymentPlan, wallet: Address) {
  const address = settlementAddress();
  if (
    !isAddressEqual(plan.contract as Address, address) ||
    !isAddressEqual(plan.wallet as Address, wallet)
  )
    throw new ApiError(
      409,
      "The saved review belongs to another wallet or deployment.",
    );
  const rpc = chainClient();
  if ((await rpc.getChainId()) !== 11155111)
    throw new ApiError(503, "The RPC is not on Sepolia.");
  const head = await rpc.getBlockNumber();
  if (head < 2n)
    throw new ApiError(503, "Sepolia confirmations are unavailable.");
  const blockNumber = head - 1n;
  const block = await rpc.getBlock({ blockNumber });
  if (block.timestamp <= BigInt(plan.deadline))
    throw new ApiError(
      409,
      "This payment can still confirm. Wait until its review expires, then check again.",
    );
  const paid = await rpc.readContract({
    address,
    abi: settlementAbi,
    functionName: "paymentRound",
    args: [wallet, plan.paymentId as Hash],
    blockNumber,
  });
  if (paid !== 0n)
    throw new ApiError(
      409,
      "A payment exists. Recover it instead of expiring the review.",
    );
  if ((await rpc.getBlock({ blockNumber })).hash !== block.hash)
    throw new ApiError(
      409,
      "The chain changed during recovery. Retry verification.",
    );
}
