import { beforeEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashTypedData } from "viem";
import { initialState } from "../../game/rules";
import { settlementResultTypes } from "../../apps/web/src/lib/settlement";
import type { RoundRow } from "../../apps/web/src/server/rounds";
const f = vi.hoisted(() => ({
  prepare: vi.fn(),
  read: vi.fn(),
  cached: vi.fn(),
  save: vi.fn(),
  sign: vi.fn(),
  retain: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/game-recovery", () => ({ retainGameplay: f.retain }));
vi.mock("@/server/prepare-settlement", () => ({
  prepareSettlement: f.prepare,
}));
vi.mock("@/server/blockchain", () => ({
  chainClient: () => ({ readContract: f.read }),
}));
vi.mock("@/server/auth", () => ({
  adminDb: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: f.cached }) }),
      upsert: f.save,
    }),
  }),
}));
vi.mock("@/server/settlement-signer", async (original) => ({
  ...(await original<object>()),
  signSettlement: f.sign,
}));
import { issueSettlement } from "../../apps/web/src/server/issue-settlement";
import {
  serializeResult,
  type PreparedResult,
} from "../../apps/web/src/server/settlement-signer";
const signer = privateKeyToAccount(generatePrivateKey());
const prepared: PreparedResult = {
  domain: {
    name: "LanternValeSettlement",
    version: "1",
    chainId: 11155111,
    verifyingContract: "0x3333333333333333333333333333333333333333",
  },
  types: settlementResultTypes,
  primaryType: "Result",
  message: {
    roundId: 7n,
    player: "0x4444444444444444444444444444444444444444",
    deposited: 10n ** 18n,
    won: true,
    fullClear: false,
    deadline: 10000n,
  },
};
const round: RoundRow = {
  id: "00000000-0000-4000-8000-000000000001",
  user_id: "fixture",
  wallet_address: prepared.message.player,
  gateway_address: prepared.domain.verifyingContract,
  contract_round_id: "7",
  entry_tx_hash: `0x${"ab".repeat(32)}`,
  entry_block_hash: `0x${"cd".repeat(32)}`,
  state: initialState("warrior", false),
  version: 1,
  created_at: "",
  class: "warrior",
  economy_version: "settlement-v1",
};
beforeEach(async () => {
  vi.resetAllMocks();
  f.retain.mockResolvedValue(undefined);
  f.prepare.mockResolvedValue(prepared);
  f.read.mockResolvedValue(signer.address);
  f.cached.mockResolvedValue({ data: null });
  f.save.mockResolvedValue({ error: null });
  f.sign.mockResolvedValue(await signer.signTypedData(prepared));
});
it("persists a verified result before returning it and reuses it during a signer outage", async () => {
  const result = await issueSettlement(round);
  expect(f.save).toHaveBeenCalledOnce();
  const saved = f.save.mock.calls[0][0];
  f.cached.mockResolvedValue({ data: saved });
  f.sign.mockRejectedValue(new Error("offline"));
  f.sign.mockClear();
  expect(await issueSettlement(round)).toEqual(result);
  expect(f.sign).not.toHaveBeenCalled();
  expect(f.prepare).toHaveBeenCalledTimes(2);
});
it("does not reuse expired, altered or retired-signer results", async () => {
  const signature = await signer.signTypedData(prepared);
  const valid = {
    signer: signer.address,
    result: serializeResult(prepared),
    signature,
    digest: hashTypedData(prepared),
  };
  const expired = {
    ...prepared,
    message: { ...prepared.message, deadline: 6000n },
  };
  for (const saved of [
    {
      ...valid,
      result: serializeResult(expired),
      signature: await signer.signTypedData(expired),
      digest: hashTypedData(expired),
    },
    { ...valid, signer: prepared.message.player },
    {
      ...valid,
      result: {
        ...valid.result,
        message: { ...valid.result.message, deposited: "999" },
      },
    },
  ]) {
    f.cached.mockResolvedValue({ data: saved });
    f.sign.mockClear();
    await issueSettlement(round);
    expect(f.sign).toHaveBeenCalledOnce();
  }
});
it("fails closed on storage errors or signer rotation during issuance", async () => {
  f.save.mockResolvedValueOnce({ error: {} });
  await expect(issueSettlement(round)).rejects.toThrow("could not be saved");
  f.read
    .mockResolvedValueOnce(signer.address)
    .mockResolvedValueOnce(prepared.message.player);
  await expect(issueSettlement(round)).rejects.toThrow("signer changed");
  f.cached.mockResolvedValueOnce({ error: {} });
  await expect(issueSettlement(round)).rejects.toThrow("unavailable");
});
