import { expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { verifySettlementClaim } from "../../apps/web/src/features/game/settlement-claim";
import {
  settlementResultTypes,
  GLOW_PRICE,
} from "../../apps/web/src/lib/settlement";
const signer = privateKeyToAccount(generatePrivateKey());
const contract = "0x3333333333333333333333333333333333333333";
const wallet = "0x4444444444444444444444444444444444444444";
const domain = {
  name: "LanternValeSettlement",
  version: "1",
  chainId: 11155111,
  verifyingContract: contract,
} as const;
const message = {
  roundId: 7n,
  player: wallet,
  deposited: GLOW_PRICE,
  won: true,
  fullClear: false,
  deadline: 10000n,
} as const;
const expected = {
  contract,
  wallet,
  roundId: "7",
  spent: 1,
  won: true,
} as const;
async function fixture() {
  const signature = await signer.signTypedData({
    domain,
    message,
    types: settlementResultTypes,
    primaryType: "Result",
  });
  const wire = {
    domain,
    primaryType: "Result",
    message: {
      ...message,
      roundId: "7",
      deposited: GLOW_PRICE.toString(),
      deadline: "10000",
    },
    signature,
  };
  const readContract = vi.fn(async ({ functionName }) =>
    functionName === "signer"
      ? signer.address
      : [wallet, GLOW_PRICE, 0, false, 0],
  );
  const getChainId = vi.fn(async () => 11155111);
  const getBlock = vi.fn(async () => ({ timestamp: 9000n }));
  const rpc = { readContract, getChainId, getBlock } as unknown as Pick<
    PublicClient,
    "getChainId" | "getBlock" | "readContract"
  >;
  return { wire, rpc, readContract, getChainId, getBlock };
}
it("verifies the exact result and current escrow before constructing a settlement call", async () => {
  const { wire, rpc } = await fixture();
  const call = await verifySettlementClaim(wire, expected, rpc);
  expect(call.address).toBe(contract);
  expect(call.functionName).toBe("settle");
  expect(call.args[0]).toEqual(message);
});
it("rejects altered recipients, amounts, chain, signatures, expiry and already-settled rounds", async () => {
  const { wire, rpc, getChainId, readContract, getBlock } = await fixture();
  for (const changed of [
    { ...wire, message: { ...wire.message, player: contract } },
    { ...wire, message: { ...wire.message, deposited: "1" } },
    { ...wire, domain: { ...wire.domain, chainId: 1 } },
    { ...wire, message: { ...wire.message, fullClear: true } },
  ])
    await expect(
      verifySettlementClaim(changed, expected, rpc),
    ).rejects.toThrow();
  getChainId.mockResolvedValueOnce(1);
  await expect(verifySettlementClaim(wire, expected, rpc)).rejects.toThrow(
    "Sepolia",
  );
  getBlock.mockResolvedValueOnce({ timestamp: 10000n });
  await expect(verifySettlementClaim(wire, expected, rpc)).rejects.toThrow(
    "expired",
  );
  readContract
    .mockImplementationOnce(async () => signer.address)
    .mockImplementationOnce(async () => [wallet, GLOW_PRICE, 0, true, 0]);
  await expect(verifySettlementClaim(wire, expected, rpc)).rejects.toThrow(
    "already settled",
  );
});
