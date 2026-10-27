import { it, expect } from "vitest";
import {
  checkedAddress,
  tokenAmount,
  CHAIN_ID,
} from "../../apps/web/src/lib/chain";
it("accepts lowercase or valid checksummed addresses and rejects wrong checksums", () => {
  expect(checkedAddress("0x52908400098527886e0f7030069857d2e4169ee7")).toBe(
    "0x52908400098527886E0F7030069857D2E4169EE7",
  );
  expect(() =>
    checkedAddress("0x52908400098527886E0F7030069857D2E4169Ee7"),
  ).toThrow();
  expect(() =>
    checkedAddress("0x0000000000000000000000000000000000000000"),
  ).toThrow();
});
it("never rounds excess precision or accepts floating-point notation", () => {
  expect(tokenAmount("0.000000000000000001")).toBe(1n);
  expect(tokenAmount("25.5")).toBe(25_500_000_000_000_000_000n);
  for (const amount of [
    "0",
    "-1",
    "1e18",
    "NaN",
    "1.0000000000000000001",
    "01",
    "1,000",
  ])
    expect(() => tokenAmount(amount)).toThrow();
  expect(CHAIN_ID).toBe(11155111);
});
