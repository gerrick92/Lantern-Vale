import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Address,
  Hash,
  ReplacementReturnType,
  TransactionReceipt,
  WaitForTransactionReceiptParameters,
} from "viem";
import {
  clearPendingTransaction,
  readPendingTransaction,
  waitForJournaledTransaction,
} from "../../apps/web/src/features/wallet/transaction-journal";

const account: Address = "0x1111111111111111111111111111111111111111";
const first: Hash = `0x${"a".repeat(64)}`;
const replacement: Hash = `0x${"b".repeat(64)}`;
const another: Hash = `0x${"c".repeat(64)}`;
const key = `mosslight:pending:${account}`;
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (name: string) => stored.get(name) ?? null,
    setItem: (name: string, value: string) => stored.set(name, value),
    removeItem: (name: string) => stored.delete(name),
  });
});
afterEach(() => vi.unstubAllGlobals());
const receipt = (hash: Hash, status: "success" | "reverted" = "success") =>
  ({ transactionHash: hash, status }) as TransactionReceipt;
function replaced(reason: ReplacementReturnType["reason"]) {
  return {
    reason,
    transactionReceipt: receipt(replacement),
  } as ReplacementReturnType;
}

it("ignores malformed hashes and wrong-chain local records", () => {
  for (const value of [
    "{",
    "null",
    "[]",
    JSON.stringify({ chainId: 1, hash: first }),
    JSON.stringify({ chainId: 11155111, hash: "0x123" }),
  ]) {
    stored.set(key, value);
    expect(readPendingTransaction(account)).toBeUndefined();
  }
});

it("tracks a fee replacement and removes the journal only after its mined receipt", async () => {
  const progress = vi.fn();
  const rpc = {
    waitForTransactionReceipt: vi.fn(
      async (options: WaitForTransactionReceiptParameters) => {
        expect(options.hash).toBe(first);
        expect(options.confirmations).toBe(2);
        expect(readPendingTransaction(account)).toBe(first);
        options.onReplaced?.(replaced("repriced"));
        expect(readPendingTransaction(account)).toBe(replacement);
        return receipt(replacement);
      },
    ),
  };
  expect(
    (await waitForJournaledTransaction(rpc, account, first, progress))
      .transactionHash,
  ).toBe(replacement);
  expect(progress).toHaveBeenCalledWith(replacement, "repriced");
  expect(readPendingTransaction(account)).toBeUndefined();
});

it("reports cancellations and reverts as failures without leaving them pending", async () => {
  for (const reason of ["cancelled", "replaced", "reverted"] as const) {
    const rpc = {
      waitForTransactionReceipt: vi.fn(
        async (options: WaitForTransactionReceiptParameters) => {
          if (reason !== "reverted") options.onReplaced?.(replaced(reason));
          return receipt(
            reason === "reverted" ? first : replacement,
            reason === "reverted" ? "reverted" : "success",
          );
        },
      ),
    };
    await expect(
      waitForJournaledTransaction(rpc, account, first, vi.fn()),
    ).rejects.toThrow(/reverted|cancelled/);
    expect(readPendingTransaction(account)).toBeUndefined();
  }
});

it("keeps the latest replacement hash when receipt polling times out", async () => {
  const rpc = {
    waitForTransactionReceipt: vi.fn(
      async (options: WaitForTransactionReceiptParameters) => {
        options.onReplaced?.(replaced("repriced"));
        throw new Error("Receipt timeout");
      },
    ),
  };
  await expect(
    waitForJournaledTransaction(rpc, account, first, vi.fn()),
  ).rejects.toThrow("Receipt timeout");
  expect(readPendingTransaction(account)).toBe(replacement);
});

it("does not overwrite or clear a newer action when an earlier action completes", async () => {
  const rpc = {
    waitForTransactionReceipt: vi.fn(
      async (options: WaitForTransactionReceiptParameters) => {
        stored.set(key, JSON.stringify({ hash: another, chainId: 11155111 }));
        options.onReplaced?.(replaced("repriced"));
        expect(readPendingTransaction(account)).toBe(another);
        return receipt(replacement);
      },
    ),
  };
  await waitForJournaledTransaction(rpc, account, first, vi.fn());
  clearPendingTransaction(account, first);
  expect(readPendingTransaction(account)).toBe(another);
});

it("still returns the confirmed receipt when optional browser storage is unavailable", async () => {
  vi.stubGlobal("sessionStorage", {
    getItem() {
      throw new Error("Blocked");
    },
    setItem() {
      throw new Error("Blocked");
    },
  });
  const rpc = { waitForTransactionReceipt: vi.fn(async () => receipt(first)) };
  expect(
    (await waitForJournaledTransaction(rpc, account, first, vi.fn())).status,
  ).toBe("success");
});
