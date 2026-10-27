import { sepolia } from "viem/chains";
import { getAddress, isAddress, parseAbi, parseUnits, zeroAddress } from "viem";

export const CHAIN_ID = sepolia.id;
export const RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";
export function checkedAddress(value: string): `0x${string}` {
  if (
    !isAddress(value, { strict: true }) ||
    value.toLowerCase() === zeroAddress
  )
    throw new Error(
      "Enter a valid, nonzero Ethereum address. Mixed-case addresses must have a valid checksum.",
    );
  return getAddress(value);
}
function optionalAddress(value?: string) {
  return value ? checkedAddress(value) : undefined;
}
export const contracts = {
  token: optionalAddress(process.env.NEXT_PUBLIC_TOKEN_ADDRESS),
  faucet: optionalAddress(process.env.NEXT_PUBLIC_FAUCET_ADDRESS),
  gateway: optionalAddress(process.env.NEXT_PUBLIC_GAME_GATEWAY_ADDRESS),
  reward: optionalAddress(process.env.NEXT_PUBLIC_REWARD_ADDRESS),
};
export function tokenAmount(value: string): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value))
    throw new Error(
      "Use a positive decimal amount with at most 18 decimal places.",
    );
  const amount = parseUnits(value, 18);
  if (amount <= 0n || amount >= 2n ** 256n)
    throw new Error("Amount is outside the supported range.");
  return amount;
}
export const faucetAbi = parseAbi([
  "function claim()",
  "function token() view returns (address)",
  "function CLAIM_AMOUNT() view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
  "function nextClaimAt(address) view returns (uint256)",
]);
export const gatewayAbi = parseAbi([
  "function startRound(bool kit) returns (uint256)",
  "function ENTRY_PRICE() view returns (uint256)",
  "function KIT_PRICE() view returns (uint256)",
  "function token() view returns (address)",
  "function rounds(uint256) view returns (address payer, bool kit, uint64 startedAt)",
  "event RoundStarted(uint256 indexed roundId, address indexed payer, uint256 amount, bool kit)",
]);
export const rewardAbi = parseAbi([
  "function claim((uint256 roundId,address recipient,uint256 amount,uint256 nonce,uint256 deadline) reward,bytes signature)",
  "function REWARD() view returns (uint256)",
  "function claimedRounds(uint256) view returns (bool)",
]);
