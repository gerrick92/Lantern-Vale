import { z } from "zod";
import {
  isAddressEqual,
  recoverTypedDataAddress,
  type Address,
  type PublicClient,
} from "viem";
import {
  GLOW_PRICE,
  settlementAbi,
  settlementResultTypes,
} from "@/lib/settlement";

const integer = z.string().regex(/^[0-9]{1,78}$/);
const resultSchema = z.object({
  domain: z.object({
    name: z.literal("LanternValeSettlement"),
    version: z.literal("1"),
    chainId: z.literal(11155111),
    verifyingContract: z.string().regex(/^0x[0-9a-f]{40}$/i),
  }),
  primaryType: z.literal("Result"),
  message: z
    .object({
      roundId: integer,
      player: z.string().regex(/^0x[0-9a-f]{40}$/i),
      deposited: integer,
      won: z.boolean(),
      fullClear: z.boolean(),
      deadline: integer,
    })
    .strict(),
  signature: z.string().regex(/^0x[0-9a-f]{130}$/i),
});
export async function verifySettlementClaim(
  input: unknown,
  expected: {
    contract: Address;
    wallet: Address;
    roundId: string;
    spent: number;
    won: boolean;
  },
  rpc: Pick<PublicClient, "getChainId" | "getBlock" | "readContract">,
) {
  const data = resultSchema.parse(input);
  const result = {
    ...data.message,
    roundId: BigInt(data.message.roundId),
    player: data.message.player as Address,
    deposited: BigInt(data.message.deposited),
    deadline: BigInt(data.message.deadline),
  };
  if (
    !isAddressEqual(
      data.domain.verifyingContract as Address,
      expected.contract,
    ) ||
    !isAddressEqual(result.player, expected.wallet) ||
    result.roundId !== BigInt(expected.roundId) ||
    !Number.isSafeInteger(expected.spent) ||
    result.deposited !== BigInt(expected.spent) * GLOW_PRICE ||
    result.won !== expected.won ||
    (!result.won && result.fullClear)
  )
    throw new Error("The settlement does not match this adventure.");
  if ((await rpc.getChainId()) !== 11155111)
    throw new Error("The provider is not on Sepolia.");
  const [signer, round, block] = await Promise.all([
    rpc.readContract({
      address: expected.contract,
      abi: settlementAbi,
      functionName: "signer",
    }),
    rpc.readContract({
      address: expected.contract,
      abi: settlementAbi,
      functionName: "rounds",
      args: [result.roundId],
    }),
    rpc.getBlock(),
  ]);
  if (round[3])
    throw new Error(
      "This adventure is already settled onchain. Refresh your wallet balance.",
    );
  if (
    !isAddressEqual(round[0], expected.wallet) ||
    round[1] !== result.deposited ||
    result.deadline <= block.timestamp
  )
    throw new Error(
      "The escrow changed or the saved result expired. Request it again.",
    );
  const signature = data.signature as `0x${string}`;
  const recovered = await recoverTypedDataAddress({
    domain: { ...data.domain, verifyingContract: expected.contract },
    types: settlementResultTypes,
    primaryType: "Result",
    message: result,
    signature,
  });
  if (!isAddressEqual(recovered, signer))
    throw new Error(
      "The result signature is not from the current settlement signer.",
    );
  return {
    address: expected.contract,
    abi: settlementAbi,
    functionName: "settle" as const,
    args: [result, signature] as const,
  };
}
