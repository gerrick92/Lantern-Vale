import { beforeEach, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Address,
} from "viem";
const f = vi.hoisted(() => ({
  rpc: {
    getChainId: vi.fn(),
    getTransactionReceipt: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    readContract: vi.fn(),
  },
  contracts: {
    token: "0x1111111111111111111111111111111111111111",
    gateway: "0x2222222222222222222222222222222222222222",
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => f.rpc,
}));
vi.mock("@/lib/chain", async () => ({
  contracts: f.contracts,
  CHAIN_ID: 11155111,
  RPC_URL: "http://rpc.invalid",
  gatewayAbi: (await import("viem")).parseAbi([
    "event RoundStarted(uint256 indexed roundId,address indexed payer,uint256 amount,bool kit)",
    "function token() view returns(address)",
    "function rounds(uint256) view returns(address payer,bool kit,uint64 startedAt)",
  ]),
}));
import { verifyPayment } from "../../apps/web/src/server/blockchain";
const wallet = "0x3333333333333333333333333333333333333333" as Address;
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
const eventAbi = parseAbi([
  "event RoundStarted(uint256 indexed roundId,address indexed payer,uint256 amount,bool kit)",
]);
function receipt(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    to: f.contracts.gateway,
    from: wallet,
    blockNumber: 100n,
    blockHash,
    logs: [event()],
    ...overrides,
  };
}
function event(
  options: {
    payer?: Address;
    amount?: bigint;
    kit?: boolean;
    source?: string;
  } = {},
) {
  return {
    address: options.source ?? f.contracts.gateway,
    topics: encodeEventTopics({
      abi: eventAbi,
      eventName: "RoundStarted",
      args: { roundId: 7n, payer: options.payer ?? wallet },
    }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }],
      [options.amount ?? 10n ** 18n, options.kit ?? false],
    ),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  f.rpc.getChainId.mockResolvedValue(11155111);
  f.rpc.getTransactionReceipt.mockResolvedValue(receipt());
  f.rpc.getBlockNumber.mockResolvedValue(101n);
  f.rpc.getBlock.mockResolvedValue({ hash: blockHash, timestamp: 1234n });
  f.rpc.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "token" ? f.contracts.token : [wallet, false, 1234],
  );
});

it("accepts only a confirmed matching gateway payment and derives the kit from its event", async () => {
  expect(await verifyPayment(hash, wallet)).toEqual({
    roundId: "7",
    kit: false,
    blockHash,
    gateway: f.contracts.gateway,
  });
  f.rpc.getTransactionReceipt.mockResolvedValue(
    receipt({ logs: [event({ kit: true, amount: 2n * 10n ** 18n })] }),
  );
  f.rpc.readContract.mockImplementation(async ({ functionName }) =>
    functionName === "token" ? f.contracts.token : [wallet, true, 1234],
  );
  expect((await verifyPayment(hash, wallet)).kit).toBe(true);
});

it("denies wrong-chain, reverted, wrong-payer and wrong-recipient receipts", async () => {
  f.rpc.getChainId.mockResolvedValueOnce(1);
  await expect(verifyPayment(hash, wallet)).rejects.toThrow("Sepolia");
  for (const bad of [
    { status: "reverted" },
    { from: f.contracts.token },
    { to: f.contracts.token },
    { to: null },
  ]) {
    f.rpc.getTransactionReceipt.mockResolvedValue(receipt(bad));
    await expect(verifyPayment(hash, wallet)).rejects.toThrow(
      "successful payment",
    );
  }
});

it("denies shallow confirmations, changed block hashes and a different token", async () => {
  f.rpc.getBlockNumber.mockResolvedValueOnce(100n);
  await expect(verifyPayment(hash, wallet)).rejects.toThrow(
    "two block confirmations",
  );
  f.rpc.getBlock.mockResolvedValueOnce({ hash, timestamp: 1234n });
  await expect(verifyPayment(hash, wallet)).rejects.toThrow(
    "chain data changed",
  );
  f.rpc.readContract.mockResolvedValueOnce(wallet);
  await expect(verifyPayment(hash, wallet)).rejects.toThrow(
    "token does not match",
  );
});

it("denies foreign, duplicate, malformed or incorrectly priced payment events", async () => {
  for (const logs of [
    [],
    [event({ source: wallet })],
    [event(), event()],
    [{ ...event(), data: "0x" }],
    [event({ amount: 0n })],
    [event({ kit: true })],
    [event({ payer: f.contracts.token as Address })],
  ]) {
    f.rpc.getTransactionReceipt.mockResolvedValue(receipt({ logs }));
    await expect(verifyPayment(hash, wallet)).rejects.toThrow();
  }
});

it("checks the stored round owner, kit and timestamp against the receipt", async () => {
  for (const round of [
    [f.contracts.token, false, 1234],
    [wallet, true, 1234],
    [wallet, false, 1235],
  ]) {
    f.rpc.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "token" ? f.contracts.token : round,
    );
    await expect(verifyPayment(hash, wallet)).rejects.toThrow(
      "Stored round does not match",
    );
  }
});
