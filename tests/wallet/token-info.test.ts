import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tokenCount, tokenPlan } from "../../apps/web/src/lib/token-info";
import { faucetFunding } from "../../apps/web/src/features/deployment/plan";

function source(path: string) {
  return readFileSync(
    new URL(`../../contracts/${path}`, import.meta.url),
    "utf8",
  );
}

function wholeTokens(sourceText: string, pattern: RegExp) {
  const match = sourceText.match(pattern);
  if (!match)
    throw new Error(
      "The contract declaration changed; review the public token explanation.",
    );
  return BigInt(match[1].replaceAll("_", ""));
}

it("the public supply cap matches the undeployed token contract", () => {
  expect(tokenPlan.cap).toBe(
    wholeTokens(source("src/SLMSToken.sol"), /ERC20Capped\(([\d_]+) ether\)/),
  );
  expect(tokenCount(tokenPlan.cap)).toBe("1,000,000");
});

it("the displayed claim amounts and rolling cooldowns match the draft contracts", () => {
  const faucet = source("src/SLMSFaucet.sol");
  const reward = source("src/LanternGameEconomy.sol");
  expect(tokenPlan.faucetClaim).toBe(
    wholeTokens(faucet, /CLAIM_AMOUNT = ([\d_]+) ether/),
  );
  expect(tokenPlan.bossReward).toBe(
    wholeTokens(reward, /BOSS_BONUS = ([\d_]+) ether/),
  );
  expect(tokenPlan.cooldownHours).toBe(
    Number(faucet.match(/COOLDOWN = (\d+) days/)?.[1]) * 24,
  );
  expect(tokenPlan.fullClearBonus).toBe(
    wholeTokens(reward, /FULL_CLEAR_BONUS = ([\d_]+) ether/),
  );
  expect(tokenPlan.dailyBonusLimit).toBe(
    wholeTokens(reward, /DAILY_BONUS_LIMIT = ([\d_]+) ether/),
  );
  expect(reward).toContain("WINDOW = 1 days");
});

it("the public initial allocation matches the token/faucet stage", () => {
  expect(tokenPlan.faucetPool * 10n ** 18n).toBe(faucetFunding);
  expect(tokenPlan.rewardPool).toBe(0n);
  expect(tokenPlan.ownerAllocation).toBe(0n);
  expect(tokenPlan.initialMint).toBe(tokenPlan.faucetPool);
  expect(tokenPlan.initialMint).toBeLessThanOrEqual(tokenPlan.cap);
});
