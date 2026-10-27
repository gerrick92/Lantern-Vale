import "server-only";
import {
  createPublicClient,
  http,
  decodeEventLog,
  isAddressEqual,
  type Hash,
} from "viem";
import { sepolia } from "viem/chains";
import { contracts, gatewayAbi, CHAIN_ID, RPC_URL } from "@/lib/chain";
import { ApiError } from "./http";
export function chainClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL || RPC_URL, {
      timeout: 15_000,
      retryCount: 1,
    }),
  });
}
export async function verifyPayment(hash: Hash, wallet: `0x${string}`) {
  if (!contracts.gateway || !contracts.token)
    throw new ApiError(503, "Adventure contracts are not deployed yet.");
  const rpc = chainClient();
  if ((await rpc.getChainId()) !== CHAIN_ID)
    throw new ApiError(503, "The RPC is not connected to Sepolia.");
  const receipt = await rpc.getTransactionReceipt({ hash });
  if (
    receipt.status !== "success" ||
    !receipt.to ||
    !isAddressEqual(receipt.to, contracts.gateway) ||
    !isAddressEqual(receipt.from, wallet)
  )
    throw new ApiError(
      400,
      "This is not a successful payment from your linked wallet to the adventure contract.",
    );
  const [latest, block, token] = await Promise.all([
    rpc.getBlockNumber(),
    rpc.getBlock({ blockNumber: receipt.blockNumber }),
    rpc.readContract({
      address: contracts.gateway,
      abi: gatewayAbi,
      functionName: "token",
    }),
  ]);
  if (latest < receipt.blockNumber + 1n)
    throw new ApiError(
      409,
      "Payment needs two block confirmations. Please retry shortly.",
    );
  if (
    block.hash !== receipt.blockHash ||
    !isAddressEqual(token, contracts.token)
  )
    throw new ApiError(
      409,
      "Payment chain data changed or the token does not match.",
    );
  const events = receipt.logs
    .filter((log) => isAddressEqual(log.address, contracts.gateway!))
    .flatMap((log) => {
      try {
        const event = decodeEventLog({
          abi: gatewayAbi,
          data: log.data,
          topics: log.topics,
          eventName: "RoundStarted",
          strict: true,
        });
        return [event.args];
      } catch {
        return [];
      }
    });
  if (events.length !== 1)
    throw new ApiError(400, "Expected exactly one paid adventure event.");
  const event = events[0];
  const expected = event.kit ? 2n * 10n ** 18n : 10n ** 18n;
  if (!isAddressEqual(event.payer, wallet) || event.amount !== expected)
    throw new ApiError(400, "Payment amount or payer does not match.");
  const round = await rpc.readContract({
    address: contracts.gateway,
    abi: gatewayAbi,
    functionName: "rounds",
    args: [event.roundId],
  });
  if (
    !isAddressEqual(round[0], wallet) ||
    round[1] !== event.kit ||
    BigInt(round[2]) !== block.timestamp
  )
    throw new ApiError(409, "Stored round does not match the payment receipt.");
  return {
    roundId: event.roundId.toString(),
    kit: event.kit,
    blockHash: receipt.blockHash,
    gateway: contracts.gateway.toLowerCase(),
  };
}
