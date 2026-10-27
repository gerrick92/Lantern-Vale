import { expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { GLOW_PRICE } from "../../apps/web/src/lib/settlement";
import {
  executePayment,
  recoverPayment,
} from "../../apps/web/src/features/game/payment-execution";
import {
  readPayment,
  paymentCalldata,
  savePayment,
  canResumePayment,
  type PaymentPlan,
} from "../../apps/web/src/features/game/payment-journal";

const wallet = "0x4444444444444444444444444444444444444444" as Address;
const contract = "0x3333333333333333333333333333333333333333" as Address;
const token = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const blockHash = `0x${"cd".repeat(32)}` as Hash;
const roundId = "00000000-0000-4000-8000-000000000001";
const plan: PaymentPlan = {
  chainId: 11155111,
  wallet,
  contract,
  token,
  paymentId: `0x${"ef".repeat(32)}`,
  deadline: "10000",
  action: { kind: "entry", classId: "white_mage" },
};
function fixture() {
  let allowance = 0n;
  const records = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      records.set(key, value);
    }),
  };
  const rpc = {
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    getChainId: vi.fn(async () => 11155111),
    getBlockNumber: vi.fn(async () => 101n),
    getBlock: vi.fn(async () => ({ hash: blockHash, timestamp: 9000n })),
    getTransaction: vi.fn(async () => ({
      to: contract,
      from: wallet,
      chainId: 11155111,
      value: 0n,
      input: paymentCalldata(plan),
      blockHash,
    })),
    readContract: vi.fn(
      async ({ functionName }: { functionName: string }) =>
        ({
          token,
          paused: false,
          balanceOf: 30n * GLOW_PRICE,
          allowance,
          paymentRound: 0n,
        })[functionName as "token"],
    ),
  };
  const receipt = {
    transactionHash: hash,
    status: "success" as const,
    blockHash,
    blockNumber: 100n,
  };
  const send = vi.fn(
    async (
      call: { functionName: string; args: readonly unknown[] },
      onSubmitted: (hash: Hash) => void,
    ) => {
      onSubmitted(hash);
      if (call.functionName === "approve") allowance = call.args[1] as bigint;
      return receipt;
    },
  );
  const register = vi.fn(async () => ({ roundId }));
  const assertWallet = vi.fn(async () => {});
  const deps = {
    storage,
    rpc: rpc as unknown as Parameters<typeof executePayment>[1]["rpc"],
    send,
    register,
    assertWallet,
  };
  return { records, storage, rpc, send, register, assertWallet, deps };
}
it("uses an exact one-token allowance, binds the chosen class and saves the receipt before registration", async () => {
  const f = fixture();
  f.register.mockImplementation(async () => {
    expect(readPayment(f.storage, wallet, contract)).toMatchObject({
      stage: "submitted",
      hash,
    });
    return { roundId };
  });
  await executePayment(plan, f.deps);
  expect(f.send.mock.calls.map(([call]) => call.functionName)).toEqual([
    "approve",
    "enter",
  ]);
  expect(f.send.mock.calls[0][0].args).toEqual([contract, GLOW_PRICE]);
  expect(f.send.mock.calls[1][0].args).toEqual([2, plan.paymentId, 10000n]);
  expect(readPayment(f.storage, wallet, contract)?.stage).toBe("recorded");
});

it("resumes an unsent review after an explicit wallet rejection without repeating a confirmed allowance", async () => {
  const f = fixture();
  const original = f.send.getMockImplementation()!;
  f.send
    .mockImplementationOnce(original)
    .mockRejectedValueOnce({ cause: { code: 4001 } });
  await expect(executePayment(plan, f.deps)).rejects.toEqual({
    cause: { code: 4001 },
  });
  expect(canResumePayment(readPayment(f.storage, wallet, contract), plan)).toBe(
    true,
  );
  await executePayment(plan, f.deps);
  expect(f.send.mock.calls.map(([call]) => call.functionName)).toEqual([
    "approve",
    "enter",
    "enter",
  ]);
  expect(f.register).toHaveBeenCalledOnce();
});

it("waits for an interrupted allowance before rechecking it and requesting entry", async () => {
  const f = fixture();
  // Simulate the earlier approval mining after the tab closed.
  await f.send(
    { functionName: "approve", args: [contract, GLOW_PRICE] },
    () => {},
  );
  f.send.mockClear();
  savePayment(f.storage, {
    version: 1,
    plan,
    stage: "approving",
    approvalHash: hash,
  });
  await executePayment(plan, f.deps);
  expect(f.rpc.waitForTransactionReceipt).toHaveBeenCalledWith({
    hash,
    confirmations: 2,
  });
  expect(f.send.mock.calls.map(([call]) => call.functionName)).toEqual([
    "enter",
  ]);
});

it("does not resend an ambiguous allowance or an entry that already has a hash", async () => {
  const f = fixture();
  savePayment(f.storage, { version: 1, plan, stage: "approving" });
  expect(canResumePayment(readPayment(f.storage, wallet, contract), plan)).toBe(
    false,
  );
  await expect(executePayment(plan, f.deps)).rejects.toThrow("unresolved");
  expect(f.send).not.toHaveBeenCalled();
  savePayment(f.storage, { version: 1, plan, stage: "submitted", hash });
  expect(canResumePayment(readPayment(f.storage, wallet, contract), plan)).toBe(
    false,
  );
});
it("recovers a mined payment after registration fails without sending a second transaction", async () => {
  const f = fixture();
  f.register.mockRejectedValueOnce(new Error("Service unavailable"));
  await expect(executePayment(plan, f.deps)).rejects.toThrow("unavailable");
  const pending = readPayment(f.storage, wallet, contract)!;
  await expect(executePayment(plan, f.deps)).rejects.toThrow(
    "Do not pay again",
  );
  const find = vi.fn();
  await recoverPayment(pending, f.deps, find);
  expect(find).not.toHaveBeenCalled();
  expect(f.send).toHaveBeenCalledTimes(2);
  expect(readPayment(f.storage, wallet, contract)?.stage).toBe("recorded");
});
it("keeps an ambiguous wallet request blocked and recovers by payment ID when the hash was lost", async () => {
  const f = fixture();
  const original = f.send.getMockImplementation()!;
  f.send.mockImplementation(async (call, onSubmitted) => {
    if (call.functionName === "enter")
      throw new Error("Connection lost after wallet request");
    return original(call, onSubmitted);
  });
  await expect(executePayment(plan, f.deps)).rejects.toThrow("Connection lost");
  const saved = readPayment(f.storage, wallet, contract)!;
  expect(saved).toMatchObject({ stage: "submitting" });
  expect(saved.hash).toBeUndefined();
  await expect(executePayment(plan, f.deps)).rejects.toThrow(
    "Do not pay again",
  );
  await recoverPayment(saved, f.deps, async (review) => {
    expect(review.paymentId).toBe(plan.paymentId);
    return hash;
  });
  expect(f.send).toHaveBeenCalledTimes(2);
});
it("stops before a wallet request if storage fails, the wallet changes or the receipt is unrelated", async () => {
  const unavailable = fixture();
  unavailable.storage.setItem.mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  await expect(executePayment(plan, unavailable.deps)).rejects.toThrow(
    "Storage blocked",
  );
  expect(unavailable.send).not.toHaveBeenCalled();
  const changed = fixture();
  changed.assertWallet
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error("Wallet changed"));
  await expect(executePayment(plan, changed.deps)).rejects.toThrow(
    "Wallet changed",
  );
  expect(changed.send).not.toHaveBeenCalled();
  const unrelated = fixture();
  unrelated.rpc.getTransaction.mockResolvedValue({
    to: token,
    from: wallet,
    chainId: 11155111,
    value: 0n,
    input: "0x",
    blockHash,
  });
  await expect(executePayment(plan, unrelated.deps)).rejects.toThrow(
    "does not match",
  );
  expect(unrelated.register).not.toHaveBeenCalled();
});
it("refuses overwritten, malformed or cross-wallet recovery records", () => {
  const f = fixture();
  const record = {
    version: 1 as const,
    plan,
    stage: "submitted" as const,
    hash,
  };
  savePayment(f.storage, record);
  expect(() =>
    savePayment(f.storage, {
      ...record,
      plan: { ...plan, paymentId: `0x${"aa".repeat(32)}` },
    }),
  ).toThrow("previous payment");
  expect(() =>
    savePayment(f.storage, {
      ...record,
      plan: { ...plan, action: { kind: "entry", classId: "thief" } },
    }),
  ).toThrow("cannot be changed");
  f.storage.getItem.mockReturnValueOnce(
    JSON.stringify({ ...record, plan: { ...plan, wallet: token } }),
  );
  expect(() => readPayment(f.storage, wallet, contract)).toThrow(
    "another wallet",
  );
  f.storage.getItem.mockReturnValueOnce("broken");
  expect(() => readPayment(f.storage, wallet, contract)).toThrow();
});

it("does not request stale approvals or payments after the reviewed deadline", async () => {
  const expired = fixture();
  expired.rpc.getBlock.mockResolvedValue({
    hash: blockHash,
    timestamp: 10000n,
  });
  await expect(executePayment(plan, expired.deps)).rejects.toThrow("expired");
  expect(expired.send).not.toHaveBeenCalled();
  const slowApproval = fixture();
  slowApproval.rpc.getBlock
    .mockResolvedValueOnce({ hash: blockHash, timestamp: 9000n })
    .mockResolvedValue({ hash: blockHash, timestamp: 10000n });
  await expect(executePayment(plan, slowApproval.deps)).rejects.toThrow(
    "expired",
  );
  expect(
    slowApproval.send.mock.calls.map(([call]) => call.functionName),
  ).toEqual(["approve"]);
});
