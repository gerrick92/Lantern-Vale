import "server-only";
import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  isAddressEqual,
  type Address,
  type Hash,
} from "viem";
import { contracts, CHAIN_ID, checkedAddress } from "@/lib/chain";
import { GLOW_PRICE, settlementAbi, settlementClasses } from "@/lib/settlement";
import type { ClassId } from "@game/rules";
import type { BeaconProof } from "./beacon-randomness";
import { chainClient } from "./blockchain";
import { ApiError } from "./http";

export type SettlementPayment = {
  chainId: 11155111;
  contract: Address;
  roundId: string;
  wallet: Address;
  hash: Hash;
  blockHash: Hash;
  blockNumber: string;
  blockTimestamp: string;
  transactionIndex: number;
  item: number | null;
  amount: string;
  totalDeposited: string;
  paymentId: Hash;
  classId: ClassId;
  deadline: string;
  randomnessProof?: BeaconProof;
};

export function settlementAddress(): Address {
  const value = process.env.SEPOLIA_GAME_ECONOMY_ADDRESS;
  if (!value)
    throw new ApiError(
      503,
      "The GLOW game settlement contract is not deployed.",
    );
  return checkedAddress(value);
}

// Read-only. No submitted hash or wallet UI flag grants an entitlement.
export async function verifySettlementPayment(
  hash: Hash,
  wallet: Address,
  purchase?: { roundId: bigint; item: number },
): Promise<SettlementPayment> {
  const address = settlementAddress();
  if (!contracts.token || !contracts.faucet)
    throw new ApiError(
      503,
      "Verified GLOW and faucet configuration is required.",
    );
  if (
    purchase &&
    (!Number.isInteger(purchase.item) ||
      purchase.item < 0 ||
      purchase.item > 8 ||
      purchase.roundId <= 0n)
  )
    throw new ApiError(400, "Invalid purchase.");
  const rpc = chainClient();
  if ((await rpc.getChainId()) !== CHAIN_ID)
    throw new ApiError(503, "The RPC is not connected to Sepolia.");
  const [receipt, tx] = await Promise.all([
    rpc.getTransactionReceipt({ hash }),
    rpc.getTransaction({ hash }),
  ]);
  let paymentId: Hash;
  let classIndex = 0;
  let deadline: bigint;
  try {
    const decoded = decodeFunctionData({ abi: settlementAbi, data: tx.input });
    if (purchase && decoded.functionName === "purchase") {
      paymentId = decoded.args[2];
      deadline = decoded.args[3];
    } else if (!purchase && decoded.functionName === "enter") {
      classIndex = decoded.args[0];
      paymentId = decoded.args[1];
      deadline = decoded.args[2];
    } else throw new Error();
    if (BigInt(paymentId) === 0n || !settlementClasses[classIndex])
      throw new Error();
  } catch {
    throw new ApiError(
      400,
      "Payment calldata does not match the expected action.",
    );
  }
  const input = purchase
    ? encodeFunctionData({
        abi: settlementAbi,
        functionName: "purchase",
        args: [purchase.roundId, purchase.item, paymentId, deadline],
      })
    : encodeFunctionData({
        abi: settlementAbi,
        functionName: "enter",
        args: [classIndex, paymentId, deadline],
      });
  if (
    receipt.status !== "success" ||
    !receipt.to ||
    !tx.to ||
    !isAddressEqual(receipt.to, address) ||
    !isAddressEqual(tx.to, address) ||
    !isAddressEqual(receipt.from, wallet) ||
    !isAddressEqual(tx.from, wallet) ||
    tx.chainId !== CHAIN_ID ||
    tx.value !== 0n ||
    tx.input.toLowerCase() !== input.toLowerCase() ||
    receipt.transactionHash !== hash ||
    tx.hash !== hash ||
    tx.blockHash !== receipt.blockHash
  )
    throw new ApiError(
      400,
      "Payment transaction does not match this wallet, contract and action.",
    );
  const [head, block, token, pool] = await Promise.all([
    rpc.getBlockNumber(),
    rpc.getBlock({ blockNumber: receipt.blockNumber }),
    rpc.readContract({
      address,
      abi: settlementAbi,
      functionName: "token",
      blockNumber: receipt.blockNumber,
    }),
    rpc.readContract({
      address,
      abi: settlementAbi,
      functionName: "recyclingPool",
      blockNumber: receipt.blockNumber,
    }),
  ]);
  if (head < receipt.blockNumber + 1n || block.hash !== receipt.blockHash)
    throw new ApiError(409, "Payment needs two canonical confirmations.");
  if (
    !isAddressEqual(token, contracts.token) ||
    !isAddressEqual(pool, contracts.faucet)
  )
    throw new ApiError(
      409,
      "Settlement token or recycling pool does not match.",
    );
  const events = receipt.logs
    .filter((log) => isAddressEqual(log.address, address))
    .flatMap((log) => {
      try {
        const event = decodeEventLog({
          abi: settlementAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        return event.eventName === "Entered" || event.eventName === "Purchased"
          ? [event]
          : [];
      } catch {
        return [];
      }
    });
  if (events.length !== 1)
    throw new ApiError(400, "Expected exactly one settlement payment event.");
  const event = events[0];
  if (
    event.args.amount !== GLOW_PRICE ||
    event.args.roundId <= 0n ||
    event.args.paymentId !== paymentId
  )
    throw new ApiError(400, "Incorrect GLOW payment amount.");
  let total = GLOW_PRICE;
  if (purchase) {
    if (
      event.eventName !== "Purchased" ||
      event.args.roundId !== purchase.roundId ||
      event.args.item !== purchase.item ||
      event.args.totalDeposited < 2n * GLOW_PRICE ||
      event.args.totalDeposited % GLOW_PRICE !== 0n
    )
      throw new ApiError(
        400,
        "Purchase event does not match the expected round and item.",
      );
    total = event.args.totalDeposited;
  } else if (
    event.eventName !== "Entered" ||
    !isAddressEqual(event.args.player, wallet) ||
    event.args.classId !== classIndex
  )
    throw new ApiError(400, "Entry event does not match the paying wallet.");
  const transfers = receipt.logs
    .filter((log) => isAddressEqual(log.address, contracts.token!))
    .flatMap((log) => {
      try {
        return [
          decodeEventLog({
            abi: erc20Abi,
            eventName: "Transfer",
            data: log.data,
            topics: log.topics,
            strict: true,
          }).args,
        ];
      } catch {
        return [];
      }
    });
  if (
    transfers.length !== 1 ||
    !isAddressEqual(transfers[0].from, wallet) ||
    !isAddressEqual(transfers[0].to, address) ||
    transfers[0].value !== GLOW_PRICE
  )
    throw new ApiError(400, "Expected the exact GLOW transfer into escrow.");
  const round = await rpc.readContract({
    address,
    abi: settlementAbi,
    functionName: "rounds",
    args: [event.args.roundId],
    blockNumber: receipt.blockNumber,
  });
  // Another valid purchase can follow in this same block; the event's total remains
  // the ordered ledger value. The database consumes events in deposit order.
  if (
    !isAddressEqual(round[0], wallet) ||
    round[1] < total ||
    !settlementClasses[round[4]] ||
    (!purchase && round[4] !== classIndex) ||
    (purchase && purchase.item < 8 && (round[2] & (1 << purchase.item)) === 0)
  )
    throw new ApiError(409, "Stored escrow round does not match the payment.");
  return {
    chainId: 11155111,
    contract: address.toLowerCase() as Address,
    roundId: event.args.roundId.toString(),
    wallet: wallet.toLowerCase() as Address,
    hash: hash.toLowerCase() as Hash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    blockTimestamp: block.timestamp.toString(),
    transactionIndex: receipt.transactionIndex,
    item: purchase?.item ?? null,
    amount: GLOW_PRICE.toString(),
    totalDeposited: total.toString(),
    paymentId,
    classId: settlementClasses[round[4]],
    deadline: deadline.toString(),
  };
}
