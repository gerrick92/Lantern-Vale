// Whole-token amounts for the initial token allocation and approved game rules.
// These are reference figures, never live balances.
export const tokenPlan = {
  cap: 1_000_000n,
  initialMint: 5_000n,
  faucetPool: 5_000n,
  rewardPool: 0n,
  ownerAllocation: 0n,
  faucetClaim: 5n,
  bossReward: 1n,
  fullClearBonus: 2n,
  dailyBonusLimit: 10n,
  cooldownHours: 24,
} as const;

export function tokenCount(amount: bigint) {
  return amount.toLocaleString("en-US");
}
