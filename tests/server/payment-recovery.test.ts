import { beforeEach, expect, it, vi } from "vitest";
import type { PaymentPlan } from "../../apps/web/src/features/game/payment-journal";
const f = vi.hoisted(() => ({
  rpc: {
    getChainId: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    readContract: vi.fn(),
    getLogs: vi.fn(),
  },
  verify: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/blockchain", () => ({ chainClient: () => f.rpc }));
vi.mock("@/server/settlement-payments", () => ({
  settlementAddress: () => "0x3333333333333333333333333333333333333333",
  verifySettlementPayment: f.verify,
}));
import { verifyUnpaidExpiry } from "../../apps/web/src/server/expire-payment";
import { findPayment } from "../../apps/web/src/server/recover-payment";
const wallet = "0x4444444444444444444444444444444444444444" as const;
const paymentId = `0x${"ef".repeat(32)}` as const;
const hash = `0x${"ab".repeat(32)}` as const;
const plan: PaymentPlan = {
  chainId: 11155111,
  wallet,
  contract: "0x3333333333333333333333333333333333333333",
  token: "0x1111111111111111111111111111111111111111",
  paymentId,
  deadline: "10000",
  action: { kind: "entry", classId: "warrior" },
};
beforeEach(() => {
  vi.resetAllMocks();
  f.rpc.getChainId.mockResolvedValue(11155111);
  f.rpc.getBlockNumber.mockResolvedValue(10001n);
  f.rpc.getBlock.mockResolvedValue({ timestamp: 10001n, hash });
  f.rpc.readContract.mockResolvedValue(0n);
});
it("releases only an unpaid review after the onchain deadline has two canonical confirmations", async () => {
  await verifyUnpaidExpiry(plan, wallet);
  expect(f.rpc.readContract.mock.calls[0][0]).toMatchObject({
    blockNumber: 10000n,
    args: [wallet, paymentId],
  });
  f.rpc.getBlock.mockResolvedValueOnce({ timestamp: 10000n, hash });
  await expect(verifyUnpaidExpiry(plan, wallet)).rejects.toThrow(
    "still confirm",
  );
  f.rpc.readContract.mockResolvedValueOnce(7n);
  await expect(verifyUnpaidExpiry(plan, wallet)).rejects.toThrow(
    "payment exists",
  );
  f.rpc.getBlock
    .mockResolvedValueOnce({ timestamp: 10001n, hash })
    .mockResolvedValueOnce({ timestamp: 10001n, hash: paymentId });
  await expect(verifyUnpaidExpiry(plan, wallet)).rejects.toThrow(
    "chain changed",
  );
  await expect(
    verifyUnpaidExpiry({ ...plan, contract: wallet }, wallet),
  ).rejects.toThrow("another wallet or deployment");
});
it("searches bounded block ranges, filters by payment ID and re-verifies recovered receipts", async () => {
  f.rpc.readContract.mockResolvedValue(7n);
  f.rpc.getLogs.mockResolvedValueOnce([]);
  expect(await findPayment(wallet, paymentId, 1n)).toEqual({
    nextBlock: "5001",
  });
  expect(f.rpc.getLogs.mock.calls[0][0]).toMatchObject({
    fromBlock: 1n,
    toBlock: 5000n,
  });
  f.rpc.getLogs.mockResolvedValueOnce([
    {
      eventName: "Entered",
      transactionHash: hash,
      args: { paymentId, roundId: 7n },
    },
  ]);
  f.verify.mockResolvedValue({ paymentId, hash });
  expect(await findPayment(wallet, paymentId, 5001n)).toEqual({
    hash,
    nextBlock: null,
  });
  expect(f.verify).toHaveBeenCalledWith(hash, wallet, undefined);
  f.rpc.readContract.mockResolvedValueOnce(0n);
  await expect(findPayment(wallet, paymentId, 1n)).rejects.toThrow(
    "do not start another",
  );
});
