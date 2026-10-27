import { expect, it } from "vitest";
import {
  supplyAccounting,
  settlementAccounting,
} from "../../apps/web/src/lib/token-supply";

it("separates held player deposits from reserved and available bonuses", () => {
  expect(settlementAccounting(100n, 8n, 2n, 90n)).toEqual({
    balance: 100n,
    deposits: 8n,
    reserved: 2n,
    available: 90n,
  });
  expect(() => settlementAccounting(100n, 8n, 2n, 98n)).toThrow("conserve");
  expect(() => settlementAccounting(1n, 8n, 2n, -9n)).toThrow("conserve");
});

it("accounts for existing supply and mint capacity without counting shared addresses twice", () => {
  const result = supplyAccounting(1_000_000n, 100_000n, [
    { address: "0xAB", label: "Owner", balance: 85_000n },
    { address: "0xab", label: "Treasury", balance: 85_000n },
    { address: "0xcd", label: "Faucet", balance: 5_000n },
  ]);
  expect(result.unminted).toBe(900_000n);
  expect(result.otherAddresses).toBe(10_000n);
  expect(result.pools).toHaveLength(2);
});
it("moves a faucet claim between existing holdings without creating supply", () => {
  const before = supplyAccounting(100n, 50n, [
    { address: "pool", label: "Faucet", balance: 10n },
  ]);
  const after = supplyAccounting(100n, 50n, [
    { address: "pool", label: "Faucet", balance: 5n },
  ]);
  expect(after.minted).toBe(before.minted);
  expect(after.unminted).toBe(before.unminted);
  expect(after.otherAddresses - before.otherAddresses).toBe(5n);
});
it("rejects inconsistent snapshots instead of displaying invented balances", () => {
  expect(() => supplyAccounting(10n, 11n, [])).toThrow();
  expect(() =>
    supplyAccounting(10n, 5n, [{ address: "a", label: "Pool", balance: 6n }]),
  ).toThrow();
  expect(() =>
    supplyAccounting(10n, 5n, [
      { address: "a", label: "Owner", balance: 1n },
      { address: "a", label: "Treasury", balance: 2n },
    ]),
  ).toThrow("same block");
});
