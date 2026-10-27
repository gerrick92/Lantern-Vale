import {
  getAddress,
  isAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";

// This isolated signing boundary deliberately accepts one protocol only.
// A regression test compares it with the application's EIP-712 definition.
export const resultTypes = {
  Result: [
    { name: "roundId", type: "uint256" },
    { name: "player", type: "address" },
    { name: "deposited", type: "uint256" },
    { name: "won", type: "bool" },
    { name: "fullClear", type: "bool" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const classes = [
  "warrior",
  "dark_knight",
  "white_mage",
  "black_mage",
  "ranger",
  "thief",
] as const;
export const address = z.string().transform((value, ctx) => {
  try {
    if (!isAddress(value)) throw new Error();
    const parsed = getAddress(value);
    if (isAddressEqual(parsed, zeroAddress)) throw new Error();
    return parsed;
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid address" });
    return z.NEVER;
  }
});
const uint = z
  .string()
  .regex(/^[1-9][0-9]{0,77}$/)
  .transform(BigInt)
  .refine((value) => value < 2n ** 256n);
const input = z.strictObject({
  domain: z.strictObject({
    name: z.literal("LanternValeSettlement"),
    version: z.literal("1"),
    chainId: z.literal(11155111),
    verifyingContract: address,
  }),
  primaryType: z.literal("Result"),
  types: z
    .strictObject({
      Result: z
        .array(z.strictObject({ name: z.string(), type: z.string() }))
        .length(6),
    })
    .refine((types) =>
      types.Result.every(
        (item, i) =>
          item.name === resultTypes.Result[i].name &&
          item.type === resultTypes.Result[i].type,
      ),
    ),
  message: z.strictObject({
    roundId: uint,
    player: address,
    deposited: uint,
    won: z.boolean(),
    fullClear: z.boolean(),
    deadline: uint,
  }),
});
export function parseResult(value: unknown, contract: Address) {
  const result = input.parse(value);
  if (
    !isAddressEqual(result.domain.verifyingContract, contract) ||
    (!result.message.won && result.message.fullClear) ||
    result.message.deposited % 10n ** 18n !== 0n
  )
    throw new Error("Invalid result");
  return { ...result, types: resultTypes };
}
export type SigningResult = ReturnType<typeof parseResult>;
export type Policy = {
  contract: Address;
  token: Address;
  pool: Address;
  signer: Address;
};
export type ChainEvidence = {
  chainId: number;
  timestamp: bigint;
  blockHash: `0x${string}`;
  token: Address;
  pool: Address;
  poolToken: Address;
  signer: Address;
  owner: Address;
  tokenOwner: Address;
  player: Address;
  deposited: bigint;
  settled: boolean;
  classId: number;
};

// The application owns game execution and canonical payment/beacon verification.
// The signer independently reads persisted terminal state, rather than accepting
// a caller's victory flag as evidence. These are separate checks on the same DB.
const roundSchema = z.object({
  chain_id: z.literal(11155111),
  gateway_address: address,
  contract_round_id: uint,
  wallet_address: address,
  economy_version: z.literal("settlement-v1"),
  class: z.enum(classes),
  state: z.object({
    rulesVersion: z.literal(5),
    mode: z.literal("paid"),
    demo: z.literal(false),
    phase: z.enum(["victory", "defeat"]),
    classId: z.enum(classes),
    hp: z.number().int().nonnegative(),
    enemyHp: z.number().int().nonnegative(),
    encounter: z.number().int().min(0).max(5),
    cleared: z.array(z.number().int().min(0).max(5)).max(6),
    spent: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
});

export function verifyEvidence(
  result: SigningResult,
  rawRound: unknown,
  chain: ChainEvidence,
  policy: Policy,
  nowSeconds: number,
) {
  const round = roundSchema.parse(rawRound);
  const { message } = result;
  const state = round.state;
  const fullClear = [0, 1, 2, 3, 4, 5].every((slot) =>
    state.cleared.includes(slot),
  );
  const won =
    state.phase === "victory" &&
    state.encounter === 5 &&
    state.enemyHp === 0 &&
    state.hp > 0 &&
    state.cleared.includes(5);
  if (
    !Number.isSafeInteger(nowSeconds) ||
    chain.timestamp < BigInt(nowSeconds - 120) ||
    chain.timestamp > BigInt(nowSeconds + 30) ||
    message.deadline < chain.timestamp + 60n ||
    message.deadline > chain.timestamp + 3660n ||
    chain.chainId !== 11155111 ||
    chain.settled ||
    !isAddressEqual(chain.token, policy.token) ||
    !isAddressEqual(chain.pool, policy.pool) ||
    !isAddressEqual(chain.poolToken, policy.token) ||
    !isAddressEqual(chain.signer, policy.signer) ||
    isAddressEqual(chain.owner, policy.signer) ||
    isAddressEqual(chain.tokenOwner, policy.signer) ||
    !isAddressEqual(message.player, chain.player) ||
    message.deposited !== chain.deposited ||
    !isAddressEqual(round.gateway_address, policy.contract) ||
    !isAddressEqual(round.wallet_address, message.player) ||
    round.contract_round_id !== message.roundId ||
    classes[chain.classId] !== round.class ||
    state.classId !== round.class ||
    BigInt(state.spent) * 10n ** 18n !== message.deposited ||
    new Set(state.cleared).size !== state.cleared.length ||
    message.won !== won ||
    message.fullClear !== (won && fullClear) ||
    (state.phase === "victory" && !won) ||
    (state.phase === "defeat" && state.hp !== 0)
  )
    throw new Error("Settlement evidence does not match");
}
