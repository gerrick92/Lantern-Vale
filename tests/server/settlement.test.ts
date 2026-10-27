import { beforeEach, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  type Address,
} from "viem";
import { GLOW_PRICE, settlementAbi } from "../../apps/web/src/lib/settlement";
import { initialState, reduceIntent } from "../../game/rules";

const f = vi.hoisted(() => ({
  rpc: {
    getChainId: vi.fn(),
    getTransactionReceipt: vi.fn(),
    getTransaction: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    readContract: vi.fn(),
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/blockchain", () => ({ chainClient: () => f.rpc }));
vi.mock("@/lib/chain", async () => ({
  CHAIN_ID: 11155111,
  checkedAddress: (value: string) => value,
  contracts: {
    token: "0x1111111111111111111111111111111111111111",
    faucet: "0x2222222222222222222222222222222222222222",
  },
}));
import { verifySettlementPayment } from "../../apps/web/src/server/settlement-payments";
import { settlementResult } from "../../apps/web/src/server/settlement-result";

const token = "0x1111111111111111111111111111111111111111" as Address;
const faucet = "0x2222222222222222222222222222222222222222" as Address;
const contract = "0x3333333333333333333333333333333333333333" as Address;
const wallet = "0x4444444444444444444444444444444444444444" as Address;
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
const paymentId = `0x${"ef".repeat(32)}` as const;
function fixture(item?: number) {
  const total = item === undefined ? GLOW_PRICE : GLOW_PRICE * 2n;
  const event =
    item === undefined
      ? {
          address: contract,
          topics: encodeEventTopics({
            abi: settlementAbi,
            eventName: "Entered",
            args: { roundId: 7n, player: wallet, paymentId },
          }),
          data: encodeAbiParameters(
            [{ type: "uint8" }, { type: "uint256" }],
            [0, GLOW_PRICE],
          ),
        }
      : {
          address: contract,
          topics: encodeEventTopics({
            abi: settlementAbi,
            eventName: "Purchased",
            args: { roundId: 7n, item, paymentId },
          }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [GLOW_PRICE, total],
          ),
        };
  const transfer = {
    address: token,
    topics: encodeEventTopics({
      abi: erc20Abi,
      eventName: "Transfer",
      args: { from: wallet, to: contract },
    }),
    data: encodeAbiParameters([{ type: "uint256" }], [GLOW_PRICE]),
  };
  const receipt = {
    transactionHash: hash,
    status: "success",
    from: wallet,
    to: contract,
    blockNumber: 100n,
    blockHash,
    transactionIndex: 0,
    logs: [event, transfer],
  };
  const tx = {
    hash,
    chainId: 11155111,
    from: wallet,
    to: contract,
    value: 0n,
    blockHash,
    input:
      item === undefined
        ? encodeFunctionData({
            abi: settlementAbi,
            functionName: "enter",
            args: [0, paymentId, 10000n],
          })
        : encodeFunctionData({
            abi: settlementAbi,
            functionName: "purchase",
            args: [7n, item, paymentId, 10000n],
          }),
  };
  f.rpc.getTransactionReceipt.mockResolvedValue(receipt);
  f.rpc.getTransaction.mockResolvedValue(tx);
  f.rpc.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "token"
      ? token
      : functionName === "recyclingPool"
        ? faucet
        : [wallet, total, item === undefined ? 0 : 1 << item, false, 0],
  );
  return { receipt, tx };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SEPOLIA_GAME_ECONOMY_ADDRESS", contract);
  f.rpc.getChainId.mockResolvedValue(11155111);
  f.rpc.getBlockNumber.mockResolvedValue(101n);
  f.rpc.getBlock.mockResolvedValue({ hash: blockHash, timestamp: 1800000000n });
  fixture();
});

it("verifies exact entry and purchase calldata, escrow transfers and historical rounds", async () => {
  const entry = await verifySettlementPayment(hash, wallet);
  expect(entry).toMatchObject({
    roundId: "7",
    amount: GLOW_PRICE.toString(),
    item: null,
  });
  fixture(1);
  expect(
    await verifySettlementPayment(hash, wallet, { roundId: 7n, item: 1 }),
  ).toMatchObject({ item: 1, totalDeposited: (GLOW_PRICE * 2n).toString() });
});
it("rejects wrong chain, wallet, ETH value, calldata and transaction destination", async () => {
  f.rpc.getChainId.mockResolvedValueOnce(1);
  await expect(verifySettlementPayment(hash, wallet)).rejects.toThrow(
    "Sepolia",
  );
  for (const override of [
    { from: faucet },
    { to: faucet },
    { value: 1n },
    { input: "0x" },
    { chainId: 1 },
    { blockHash: hash },
  ]) {
    const { tx } = fixture();
    f.rpc.getTransaction.mockResolvedValue({ ...tx, ...override });
    await expect(verifySettlementPayment(hash, wallet)).rejects.toThrow(
      "does not match",
    );
  }
});
it("rejects noncanonical receipts, shallow confirmations and missing or duplicated transfers", async () => {
  f.rpc.getBlock.mockResolvedValueOnce({ hash });
  await expect(verifySettlementPayment(hash, wallet)).rejects.toThrow(
    "canonical",
  );
  f.rpc.getBlockNumber.mockResolvedValueOnce(100n);
  await expect(verifySettlementPayment(hash, wallet)).rejects.toThrow(
    "canonical",
  );
  for (const duplicated of [false, true]) {
    const { receipt } = fixture();
    f.rpc.getTransactionReceipt.mockResolvedValue({
      ...receipt,
      logs: duplicated ? [...receipt.logs, receipt.logs[1]] : [receipt.logs[0]],
    });
    await expect(verifySettlementPayment(hash, wallet)).rejects.toThrow(
      "exact GLOW transfer",
    );
  }
});
it("rejects purchases for another round or item even with otherwise valid logs", async () => {
  fixture(1);
  await expect(
    verifySettlementPayment(hash, wallet, { roundId: 8n, item: 1 }),
  ).rejects.toThrow();
  await expect(
    verifySettlementPayment(hash, wallet, { roundId: 7n, item: 0 }),
  ).rejects.toThrow();
  f.rpc.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "token"
      ? token
      : functionName === "recyclingPool"
        ? faucet
        : [faucet, 2n * GLOW_PRICE, 2, false],
  );
  await expect(
    verifySettlementPayment(hash, wallet, { roundId: 7n, item: 1 }),
  ).rejects.toThrow("Stored escrow");
});
it("requires receipt authority for paid supplies and refuses it inside client intents", () => {
  let state = initialState("warrior", false);
  state = reduceIntent(state, { type: "visit", place: "armor" });
  expect(() => reduceIntent(state, { type: "buy", item: "armor" })).toThrow(
    "confirmed GLOW",
  );
  expect(() => reduceIntent(state, { type: "buy", item: "armor" }, 0)).toThrow(
    "confirmed GLOW",
  );
  const next = reduceIntent(state, { type: "buy", item: "armor" }, 1);
  expect(next.spent).toBe(2);
  expect(next.gold).toBe(0);
  expect(state.spent).toBe(1);
  expect(() => reduceIntent(next, { type: "buy", item: "armor" }, 1)).toThrow(
    "sold out",
  );
});
it("rejects a changed class or payment identifier even when the receipt otherwise matches", async () => {
  for (const args of [
    [5, paymentId, 10000n],
    [0, hash, 10000n],
  ] as const) {
    const { tx } = fixture();
    f.rpc.getTransaction.mockResolvedValue({
      ...tx,
      input: encodeFunctionData({
        abi: settlementAbi,
        functionName: "enter",
        args,
      }),
    });
    await expect(verifySettlementPayment(hash, wallet)).rejects.toThrow();
  }
});
it("prepares exact deposit returns and boss/full-clear results without trusting client amounts", async () => {
  const entry = await verifySettlementPayment(hash, wallet);
  const state = {
    ...initialState("warrior", false),
    phase: "victory" as const,
    encounter: 5,
    enemyHp: 0,
    cleared: [5],
  };
  const result = settlementResult(
    state,
    wallet,
    contract,
    7n,
    [entry],
    999999n,
  );
  expect(result.message).toEqual({
    roundId: 7n,
    player: wallet,
    deposited: GLOW_PRICE,
    won: true,
    fullClear: false,
    deadline: 999999n,
  });
  expect(
    settlementResult(
      { ...state, cleared: [0, 1, 2, 3, 4, 5] },
      wallet,
      contract,
      7n,
      [entry],
      999999n,
    ).message.fullClear,
  ).toBe(true);
  expect(() =>
    settlementResult(
      { ...state, mode: "practice" },
      wallet,
      contract,
      7n,
      [entry],
      999999n,
    ),
  ).toThrow();
  expect(() =>
    settlementResult(
      { ...state, spent: 2 },
      wallet,
      contract,
      7n,
      [entry],
      999999n,
    ),
  ).toThrow("agree");
  expect(() =>
    settlementResult(state, wallet, contract, 7n, [entry, entry], 999999n),
  ).toThrow("duplicate");
  expect(() =>
    settlementResult(
      state,
      wallet,
      contract,
      7n,
      [{ ...entry, totalDeposited: (GLOW_PRICE * 2n).toString() }],
      999999n,
    ),
  ).toThrow("gap");
});
