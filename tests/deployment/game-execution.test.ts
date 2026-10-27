import { describe, expect, it, vi } from "vitest";
import { gameDeploymentFixture, fixtureHash } from "../helpers/game-deployment";
import { prepareGameTransaction } from "../../apps/web/src/features/deployment/game-transaction";
import {
  executeGameTransaction,
  readGameJournal,
  adoptGameReceipts,
  type GameExecutionContext,
  type GameJournal,
} from "../../apps/web/src/features/deployment/game-execution";

function execution() {
  const f = gameDeploymentFixture();
  let stored: GameJournal = { fingerprint: f.plan.fingerprint };
  const rpc = {
    ...f.mock,
    estimateGas: vi.fn(async () => 100n),
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 2n,
    })),
    getBalance: vi.fn(async () => 1_000_000n),
    waitForTransactionReceipt: vi.fn(async () => f.deployment),
  };
  const wallet = {
    getChainId: vi.fn(async () => 11155111),
    getAddresses: vi.fn(async () => [f.plan.owner]),
    sendTransaction: vi.fn(async () => f.hashes.deploymentHash),
  };
  const context = {
    plan: f.plan,
    wallet,
    rpc,
    read: () => readGameJournal(JSON.stringify(stored), f.plan.fingerprint),
    save: vi.fn((value: GameJournal) => {
      stored = structuredClone(value);
    }),
    prepare: vi.fn((hashes) =>
      prepareGameTransaction(f.rpc, f.plan, f.artifact, hashes),
    ),
    report: vi.fn(),
  } satisfies GameExecutionContext;
  return { ...f, context, wallet, rpc, stored: () => stored };
}

describe("owner game deployment transaction recovery", () => {
  it("estimates without sending, persists uncertainty before the prompt, and confirms before advancing", async () => {
    const f = execution();
    const { estimate } = await executeGameTransaction(f.context, "estimate");
    expect(f.wallet.sendTransaction).not.toHaveBeenCalled();
    f.wallet.sendTransaction.mockImplementation(async () => {
      expect(f.stored()).toMatchObject({ inFlight: "deploy" });
      return f.hashes.deploymentHash;
    });
    const result = await executeGameTransaction(f.context, "submit", estimate);
    expect(result.prepared.step).toBe("fund");
    expect(f.stored()).toEqual({
      fingerprint: f.plan.fingerprint,
      deploymentHash: f.hashes.deploymentHash,
    });
    expect(f.wallet.sendTransaction).toHaveBeenCalledExactlyOnceWith({
      account: f.plan.owner,
      chain: expect.objectContaining({ id: 11155111 }),
      data: f.plan.deployment.data,
      to: undefined,
      value: 0n,
      gas: 120n,
      maxFeePerGas: 5n,
      maxPriorityFeePerGas: 2n,
    });
    expect(f.rpc.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ confirmations: 2 }),
    );
  });
  it.each([4001, -32000])(
    "handles wallet error %s without retrying an ambiguous submission",
    async (code) => {
      const f = execution();
      const { estimate } = await executeGameTransaction(f.context, "estimate");
      f.wallet.sendTransaction.mockRejectedValue({ cause: { code } });
      await expect(
        executeGameTransaction(f.context, "submit", estimate),
      ).rejects.toBeDefined();
      expect(f.stored().inFlight).toBe(code === 4001 ? undefined : "deploy");
      if (code !== 4001) {
        await expect(
          executeGameTransaction(f.context, "resume"),
        ).rejects.toThrow("may have submitted");
        expect(f.wallet.sendTransaction).toHaveBeenCalledTimes(1);
      }
    },
  );
  it("recovers a mined pending transaction without sending again after a verification outage", async () => {
    const f = execution();
    const { estimate } = await executeGameTransaction(f.context, "estimate");
    f.mock.getTransactionReceipt.mockRejectedValueOnce(
      new Error("RPC unavailable"),
    );
    await expect(
      executeGameTransaction(f.context, "submit", estimate),
    ).rejects.toThrow();
    expect(f.stored().pending?.hash).toBe(f.hashes.deploymentHash);
    await executeGameTransaction(f.context, "resume");
    expect(f.wallet.sendTransaction).toHaveBeenCalledTimes(1);
    expect(f.stored().pending).toBeUndefined();
  });
  it("preserves pending state for reverted or substituted transactions", async () => {
    const f = execution();
    const { estimate } = await executeGameTransaction(f.context, "estimate");
    f.tx.input = "0x6002";
    await expect(
      executeGameTransaction(f.context, "submit", estimate),
    ).rejects.toThrow("Receipt does not match");
    expect(f.stored().pending?.hash).toBe(f.hashes.deploymentHash);
  });
  it("rechecks the wallet after preparation so account changes cannot submit", async () => {
    const f = execution();
    const { estimate } = await executeGameTransaction(f.context, "estimate");
    f.wallet.getAddresses
      .mockResolvedValueOnce([f.plan.owner])
      .mockResolvedValue([f.plan.signer]);
    await expect(
      executeGameTransaction(f.context, "submit", estimate),
    ).rejects.toThrow("owner wallet");
    expect(f.wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["wallet", "rpc"])(
    "rejects a wrong %s chain before preparation",
    async (target) => {
      const f = execution();
      f[target as "wallet" | "rpc"].getChainId.mockResolvedValue(1);
      await expect(
        executeGameTransaction(f.context, "estimate"),
      ).rejects.toThrow("Sepolia");
      expect(f.context.prepare).not.toHaveBeenCalled();
    },
  );
  it("rejects stale estimates, insufficient balance and missing review", async () => {
    const f = execution();
    const { estimate } = await executeGameTransaction(f.context, "estimate");
    await expect(executeGameTransaction(f.context, "submit")).rejects.toThrow(
      "Estimate and review",
    );
    await expect(
      executeGameTransaction(f.context, "submit", {
        ...estimate!,
        at: Date.now() - 121_000,
      }),
    ).rejects.toThrow("Estimate and review");
    f.rpc.getBalance.mockResolvedValue(1n);
    await expect(
      executeGameTransaction(f.context, "submit", estimate),
    ).rejects.toThrow("Insufficient");
    expect(f.wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it("refuses a changed prepared recipient or calldata", async () => {
    const f = execution();
    const real = await f.context.prepare({});
    f.context.prepare.mockResolvedValue({
      ...real,
      transaction: { ...real.transaction!, data: "0x1234" },
    });
    await expect(executeGameTransaction(f.context, "estimate")).rejects.toThrow(
      "differs",
    );
    expect(f.rpc.estimateGas).not.toHaveBeenCalled();
  });
  it("funds only a freshly verified paused deployment and does not repeat a completed mint", async () => {
    const f = execution();
    f.context.save({
      fingerprint: f.plan.fingerprint,
      deploymentHash: f.hashes.deploymentHash,
    });
    const { estimate } = await executeGameTransaction(f.context, "estimate");
    f.wallet.sendTransaction.mockImplementation(async () => {
      f.states.availableBonusPool = BigInt(f.plan.reserveUnits);
      f.states.balanceOf = BigInt(f.plan.reserveUnits);
      return fixtureHash("2");
    });
    f.rpc.waitForTransactionReceipt.mockResolvedValue(f.funding);
    const result = await executeGameTransaction(f.context, "submit", estimate);
    expect(result.prepared.step).toBe("done");
    expect(f.wallet.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        to: f.plan.token,
        data: f.fundingTx.input,
        value: 0n,
      }),
    );
    await executeGameTransaction(f.context, "submit", estimate);
    expect(f.wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });
  it("fails closed on corrupt journals and does not replace an existing deployment during receipt import", () => {
    const f = execution();
    for (const changed of [
      { fingerprint: "changed" },
      { fingerprint: f.plan.fingerprint, fundingHash: fixtureHash("2") },
      {
        fingerprint: f.plan.fingerprint,
        deploymentHash: fixtureHash("1"),
        pending: { step: "deploy", hash: fixtureHash("3") },
      },
    ])
      expect(() =>
        readGameJournal(JSON.stringify(changed), f.plan.fingerprint),
      ).toThrow();
    const journal = {
      fingerprint: f.plan.fingerprint,
      deploymentHash: fixtureHash("1"),
      inFlight: "fund" as const,
    };
    expect(() =>
      adoptGameReceipts(journal, { deploymentHash: fixtureHash("3") }),
    ).toThrow();
    expect(() =>
      adoptGameReceipts(journal, { deploymentHash: fixtureHash("1") }),
    ).toThrow();
    expect(
      adoptGameReceipts(journal, {
        deploymentHash: fixtureHash("1"),
        fundingHash: fixtureHash("2"),
      }).inFlight,
    ).toBeUndefined();
  });
});
