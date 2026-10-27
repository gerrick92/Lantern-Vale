import "server-only";
import { type Address, type Hash } from "viem";
import { settlementAbi } from "@/lib/settlement";
import { chainClient } from "./blockchain";
import {
  settlementAddress,
  verifySettlementPayment,
} from "./settlement-payments";
import { ApiError } from "./http";

export async function findPayment(
  wallet: Address,
  paymentId: Hash,
  fromBlock: bigint,
) {
  const address = settlementAddress();
  const rpc = chainClient();
  if ((await rpc.getChainId()) !== 11155111)
    throw new ApiError(503, "The RPC is not on Sepolia.");
  const id = await rpc.readContract({
    address,
    abi: settlementAbi,
    functionName: "paymentRound",
    args: [wallet, paymentId],
  });
  if (id === 0n)
    throw new ApiError(
      409,
      "No mined payment was found yet. Check MetaMask Activity; do not start another payment.",
    );
  const head = await rpc.getBlockNumber();
  // Bound each request; the caller can resume with the next block range.
  const toBlock = fromBlock + 4999n < head ? fromBlock + 4999n : head;
  if (fromBlock > head)
    throw new ApiError(400, "The recovery block is ahead of Sepolia.");
  const logs = await rpc.getLogs({
    address,
    events: settlementAbi.filter(
      (item) =>
        item.type === "event" && ["Entered", "Purchased"].includes(item.name),
    ),
    fromBlock,
    toBlock,
    strict: true,
  });
  const matches = logs.filter(
    (log) =>
      "paymentId" in log.args &&
      log.args.paymentId === paymentId &&
      "roundId" in log.args &&
      log.args.roundId === id,
  );
  if (matches.length > 1)
    throw new ApiError(
      409,
      "Conflicting payment events require reconciliation.",
    );
  const found = matches[0];
  if (!found)
    return { nextBlock: toBlock < head ? (toBlock + 1n).toString() : null };
  if (!found.transactionHash)
    throw new ApiError(409, "Payment is still pending.");
  const purchase =
    found.eventName === "Purchased" && "item" in found.args
      ? { roundId: id, item: found.args.item as number }
      : undefined;
  const payment = await verifySettlementPayment(
    found.transactionHash,
    wallet,
    purchase,
  );
  if (payment.paymentId !== paymentId)
    throw new ApiError(409, "Payment recovery did not match.");
  return { hash: payment.hash, nextBlock: null };
}
