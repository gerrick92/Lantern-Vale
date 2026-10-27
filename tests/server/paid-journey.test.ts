import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  classIds,
  encounterLocations,
  roads,
  type GameState,
  type Intent,
  paymentItem,
} from "../../game/rules";
import { databaseAdapter, localDatabase } from "../helpers/local-database";
import { memoryGameRecovery } from "../helpers/game-recovery";
import { captureCheckpoint, restoreCheckpoint } from "../helpers/recovery";
import { tacticalAction } from "../helpers/combat-policy";
import {
  GLOW_PRICE,
  settlementAbi,
  settlementClasses,
  settlementResultTypes,
} from "../../apps/web/src/lib/settlement";
import {
  executePayment,
  recoverPayment,
} from "../../apps/web/src/features/game/payment-execution";
import {
  readPayment,
  type PaymentPlan,
} from "../../apps/web/src/features/game/payment-journal";
import { verifySettlementClaim } from "../../apps/web/src/features/game/settlement-claim";

const f = vi.hoisted(() => ({
  user: "00000000-0000-4000-8000-000000000001",
  database: undefined as unknown,
  retain: undefined as unknown as (userId: string) => Promise<void>,
  beacon: true,
  signer: true,
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
vi.mock("@/server/game-recovery", () => ({
  retainGameplay: (userId: string) => f.retain(userId),
}));
vi.mock("@/lib/economy-release", () => ({ paidEconomyReady: true })); // Test module only; the application gate stays false.
vi.mock("@/server/blockchain", () => ({ chainClient: () => f.rpc }));
vi.mock("@/lib/chain", () => ({
  CHAIN_ID: 11155111,
  checkedAddress: (value: string) => value,
  contracts: {
    token: "0x1111111111111111111111111111111111111111",
    faucet: "0x2222222222222222222222222222222222222222",
  },
}));
vi.mock("@/server/auth", () => ({
  adminDb: () => f.database,
  requireUser: async () => ({ user: { id: f.user }, db: f.database }),
  linkedWallet: async () => "0x4444444444444444444444444444444444444444",
  rateLimit: async () => {},
}));
import { POST as entry } from "../../apps/web/src/app/api/rounds/route";
import { POST as action } from "../../apps/web/src/app/api/rounds/[id]/actions/route";
import { GET as reload } from "../../apps/web/src/app/api/rounds/[id]/route";
import { POST as claim } from "../../apps/web/src/app/api/rounds/[id]/claim/route";

const owner = f.user,
  other = "00000000-0000-4000-8000-000000000002";
const wallet: Address = "0x4444444444444444444444444444444444444444",
  contract: Address = "0x3333333333333333333333333333333333333333",
  token: Address = "0x1111111111111111111111111111111111111111",
  faucet: Address = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"cd".repeat(32)}` as Hash,
  genesis = 1692803367n;
const signer = privateKeyToAccount(generatePrivateKey()); // Ephemeral, unfunded fixture; never persisted.
const beacon = {
  round: 1,
  signature:
    "b55e7cb2d5c613ee0b2e28d6750aabbb78c39dcc96bd9d38c2c2e12198df95571de8e8e402a0cc48871c7089a2b3af4b",
};
let db: Awaited<ReturnType<typeof localDatabase>>,
  nonce = 0,
  roundNonce = 0n,
  allowance = 0n;
const hex = () => `0x${(++nonce).toString(16).padStart(64, "0")}` as Hash;
type Escrow = [Address, bigint, number, boolean, number];
const escrows = new Map<bigint, Escrow>(),
  paymentRounds = new Map<string, bigint>();
type Receipt = {
  transactionHash: Hash;
  status: "success";
  from: Address;
  to: Address;
  blockNumber: bigint;
  blockHash: Hash;
  transactionIndex: number;
  logs: unknown[];
};
const receipts = new Map<Hash, Receipt>(),
  transactions = new Map<Hash, object>();
beforeAll(async () => {
  db = await localDatabase([owner, other]);
  f.database = db.api;
  f.retain = memoryGameRecovery(() => f.database as typeof db.api);
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.stubEnv("SEPOLIA_GAME_ECONOMY_ADDRESS", contract);
  vi.stubEnv("SETTLEMENT_SIGNER_URL", "https://fixture.invalid/sign");
  vi.stubEnv("SETTLEMENT_SIGNER_TOKEN", "local-fixture-only");
  f.rpc.getChainId.mockResolvedValue(11155111);
  f.rpc.getBlockNumber.mockResolvedValue(101n);
  f.rpc.getBlock.mockImplementation(async (args) => ({
    hash: blockHash,
    timestamp: args?.blockNumber ? genesis - 60n : genesis + 100n,
  }));
  f.rpc.getTransactionReceipt.mockImplementation(async ({ hash }) =>
    receipts.get(hash),
  );
  f.rpc.getTransaction.mockImplementation(async ({ hash }) =>
    transactions.get(hash),
  );
  f.rpc.readContract.mockImplementation(async ({ functionName, args }) => {
    if (functionName === "rounds") return escrows.get(args[0]);
    if (functionName === "paymentRound")
      return paymentRounds.get(args[1]) ?? 0n;
    return {
      token,
      recyclingPool: faucet,
      signer: signer.address,
      paused: false,
      balanceOf: 1000n * GLOW_PRICE,
      allowance,
    }[functionName as "token"];
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (String(url).includes("drand.sh"))
        return f.beacon
          ? Response.json(beacon)
          : new Response("pending", { status: 503 });
      if (String(url) !== "https://fixture.invalid/sign")
        throw new Error("Unexpected network access from an offline test.");
      if (!f.signer) return new Response("offline", { status: 503 });
      const data = JSON.parse(options.body);
      return Response.json({
        signature: await signer.signTypedData({
          domain: data.domain,
          types: settlementResultTypes,
          primaryType: "Result",
          message: {
            ...data.message,
            roundId: BigInt(data.message.roundId),
            deposited: BigInt(data.message.deposited),
            deadline: BigInt(data.message.deadline),
          },
        }),
      });
    }),
  );
}, 30000);
afterAll(async () => {
  await db.sql.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const request = (body: unknown) =>
  new Request("http://127.0.0.1:3000/api/rounds", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function result(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error}`);
  return data;
}
function mine(plan: PaymentPlan) {
  const hash = hex(),
    id =
      plan.action.kind === "entry"
        ? ++roundNonce
        : BigInt(plan.action.contractRoundId);
  const item =
    plan.action.kind === "entry" ? undefined : paymentItem(plan.action.intent)!;
  const escrow =
    item === undefined
      ? ([
          wallet,
          0n,
          0,
          false,
          settlementClasses.indexOf(
            plan.action.kind === "entry" ? plan.action.classId : "warrior",
          ),
        ] as Escrow)
      : escrows.get(id)!;
  if (paymentRounds.has(plan.paymentId))
    throw new Error("The local chain fixture rejected a duplicate payment ID.");
  escrow[1] += GLOW_PRICE;
  if (item !== undefined) escrow[2] |= 1 << item;
  escrows.set(id, escrow);
  paymentRounds.set(plan.paymentId, id);
  allowance -= GLOW_PRICE;
  const input =
    item === undefined
      ? encodeFunctionData({
          abi: settlementAbi,
          functionName: "enter",
          args: [escrow[4], plan.paymentId as Hash, BigInt(plan.deadline)],
        })
      : encodeFunctionData({
          abi: settlementAbi,
          functionName: "purchase",
          args: [id, item, plan.paymentId as Hash, BigInt(plan.deadline)],
        });
  const paymentEvent =
    item === undefined
      ? {
          address: contract,
          topics: encodeEventTopics({
            abi: settlementAbi,
            eventName: "Entered",
            args: {
              roundId: id,
              player: wallet,
              paymentId: plan.paymentId as Hash,
            },
          }),
          data: encodeAbiParameters(
            [{ type: "uint8" }, { type: "uint256" }],
            [escrow[4], GLOW_PRICE],
          ),
        }
      : {
          address: contract,
          topics: encodeEventTopics({
            abi: settlementAbi,
            eventName: "Purchased",
            args: { roundId: id, item, paymentId: plan.paymentId as Hash },
          }),
          data: encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [GLOW_PRICE, escrow[1]],
          ),
        };
  const receipt: Receipt = {
    transactionHash: hash,
    status: "success",
    from: wallet,
    to: contract,
    blockNumber: 100n,
    blockHash,
    transactionIndex: nonce,
    logs: [
      paymentEvent,
      {
        address: token,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: "Transfer",
          args: { from: wallet, to: contract },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [GLOW_PRICE]),
      },
    ],
  };
  receipts.set(hash, receipt);
  transactions.set(hash, {
    hash,
    from: wallet,
    to: contract,
    chainId: 11155111,
    value: 0n,
    input,
    blockHash,
  });
  return receipt;
}

it.each(["boss", "full", "defeat"] as const)(
  "persists and reconciles the complete %s journey across database restore, payment interruption and signer outage",
  async (ending) => {
    f.user = owner;
    f.beacon = true;
    f.signer = true;
    const storageMap = new Map<string, string>(),
      storage = {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storageMap.set(key, value);
        },
      };
    let id = "",
      state: GameState,
      version = 0,
      contractRoundId = "",
      loseResponse = false;
    const classId = classIds[ending === "boss" ? 0 : ending === "full" ? 2 : 5];
    const base = {
      chainId: 11155111 as const,
      wallet,
      contract,
      token,
      deadline: String(genesis + 600n),
    };
    async function restore(stage: string) {
      const checkpoint = await captureCheckpoint(db.sql, `${ending}-${stage}`);
      await db.sql.close();
      db = databaseAdapter(await restoreCheckpoint(checkpoint));
      f.database = db.api;
    }
    async function refresh() {
      const saved = await result(await reload(request({}), context(id)));
      state = saved.state;
      version = saved.version;
      contractRoundId = saved.contractRoundId;
      return saved;
    }
    const register = async (hash: Hash, plan: PaymentPlan) => {
      if (plan.action.kind === "entry")
        return {
          roundId: (
            await result(
              await entry(request({ hash, classId: plan.action.classId })),
            )
          ).id as string,
        };
      await result(
        await action(
          request({
            version: plan.action.version,
            requestId: plan.action.requestId,
            intent: plan.action.intent,
            paymentHash: hash,
          }),
          context(plan.action.roundId),
        ),
      );
      if (loseResponse) {
        loseResponse = false;
        throw new Error(
          "Connection lost after the server committed the purchase",
        );
      }
      return { roundId: plan.action.roundId };
    };
    async function pay(plan: PaymentPlan, interrupted = false) {
      const reserved = await db.api.rpc("reserve_payment_review", {
        p_user: owner,
        p_plan: plan,
      });
      expect(reserved.error).toBeNull();
      const sends = vi.fn(
        async (
          call: { functionName: string; args: readonly unknown[] },
          submitted: (hash: Hash) => void,
        ) => {
          if (call.functionName === "approve") {
            allowance = call.args[1] as bigint;
            const hash = hex();
            submitted(hash);
            return {
              transactionHash: hash,
              status: "success" as const,
              blockHash,
              blockNumber: 100n,
            };
          }
          const receipt = mine(plan);
          submitted(receipt.transactionHash);
          return receipt;
        },
      );
      const deps = {
        rpc: f.rpc as unknown as Parameters<typeof executePayment>[1]["rpc"],
        storage,
        send: sends,
        register,
        assertWallet: async () => {},
      };
      let registered;
      if (interrupted) {
        await expect(executePayment(plan, deps)).rejects.toThrow();
        const pending = readPayment(storage, wallet, contract)!;
        const count = receipts.size;
        await restore(plan.action.kind);
        f.beacon = true;
        registered = await recoverPayment(pending, deps, async () => {
          throw new Error("The saved hash must be used.");
        });
        expect(receipts.size).toBe(count);
      } else registered = await executePayment(plan, deps);
      id = registered.roundId;
      await refresh();
      expect(readPayment(storage, wallet, contract)?.stage).toBe("recorded");
    }
    f.beacon = false;
    await pay(
      { ...base, paymentId: hex(), action: { kind: "entry", classId } },
      true,
    );
    async function act(intent: Intent, interrupt = false) {
      const item = paymentItem(intent);
      if (item !== undefined) {
        loseResponse = interrupt;
        await pay(
          {
            ...base,
            paymentId: hex(),
            action: {
              kind: "purchase",
              roundId: id,
              contractRoundId,
              version,
              requestId: randomUUID(),
              intent,
            },
          },
          interrupt,
        );
      } else {
        await result(
          await action(
            request({ version, requestId: randomUUID(), intent }),
            context(id),
          ),
        );
        await refresh();
      }
    }
    const started = await refresh();
    f.user = other;
    expect((await reload(request({}), context(id))).status).toBe(404);
    f.user = owner;
    await act({ type: "visit", place: "armor" });
    await act({ type: "buy", item: "armor" }, true);
    await act({ type: "visit", place: "weapon" });
    await act({ type: "buy", item: "weapon" });
    await act({ type: "dancer" });
    await act({ type: "move", destination: "clearing" });
    await act({ type: "fairy" });
    if (state!.curse || state!.hp < state!.maxHp || state!.mp < state!.maxMp) {
      await act({ type: "move", destination: "inn" });
      await act({ type: "visit", place: "inn" });
      await act({ type: "rest" });
      await act({ type: "move", destination: "clearing" });
    }
    if (ending === "defeat") {
      await act({ type: "move", destination: "forest1" });
      await act({ type: "encounter", slot: 0 });
      while (state!.phase === "combat") await act({ type: "guard" });
    } else
      for (let turns = 0; turns < 220 && state!.phase !== "victory"; turns++) {
        if (state!.phase === "combat") await act(tacticalAction(state!));
        else {
          const slot = encounterLocations.findIndex(
            (place, index) =>
              place === state!.location &&
              !state!.cleared.includes(index) &&
              (ending === "full" || index === 5),
          );
          await act(
            slot >= 0
              ? { type: "encounter", slot }
              : {
                  type: "move",
                  destination: roads[roads.indexOf(state!.location) + 1],
                },
          );
        }
      }
    expect(state!.phase).toBe(ending === "defeat" ? "defeat" : "victory");
    expect(state!.refunded).toBe(0); // Only a mined contract settlement can return GLOW.
    expect(
      (
        await action(
          request({
            version: started.version,
            requestId: randomUUID(),
            intent: { type: "attack" },
          }),
          context(id),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await action(
          request({
            version,
            requestId: randomUUID(),
            intent: { type: "attack", won: true },
          }),
          context(id),
        )
      ).status,
    ).toBe(400);
    f.signer = false;
    expect((await claim(request({}), context(id))).status).toBe(503);
    expect((await refresh()).state.phase).toBe(state!.phase);
    f.signer = true;
    const signed = await result(await claim(request({}), context(id)));
    expect(signed.message.deposited).toBe(
      (BigInt(state!.spent) * GLOW_PRICE).toString(),
    );
    expect(signed.message.won).toBe(ending !== "defeat");
    expect(signed.message.fullClear).toBe(ending === "full");
    const call = await verifySettlementClaim(
      signed,
      {
        contract,
        wallet,
        roundId: contractRoundId,
        spent: state!.spent,
        won: ending !== "defeat",
      },
      f.rpc as unknown as Parameters<typeof verifySettlementClaim>[2],
    );
    expect(call.functionName).toBe("settle");
    await restore("signed-result");
    f.signer = false;
    expect(await result(await claim(request({}), context(id)))).toEqual(signed);
    // Recovery must still compare the restored ledger with canonical chain state.
    const escrow = escrows.get(BigInt(contractRoundId))!;
    escrow[1] += GLOW_PRICE;
    expect((await claim(request({}), context(id))).status).toBe(409);
    escrow[1] -= GLOW_PRICE;
    expect(await result(await claim(request({}), context(id)))).toEqual(signed);
    const current = structuredClone(state!);
    await db.sql.query("update game_rounds set state=$1 where id=$2", [
      { ...current, encounters: [99, ...current.encounters.slice(1)] },
      id,
    ]);
    expect((await claim(request({}), context(id))).status).toBe(500);
    await db.sql.query("update game_rounds set state=$1 where id=$2", [
      current,
      id,
    ]);
    escrows.get(BigInt(contractRoundId))![3] = true;
    await expect(
      verifySettlementClaim(
        signed,
        {
          contract,
          wallet,
          roundId: contractRoundId,
          spent: current.spent,
          won: ending !== "defeat",
        },
        f.rpc as unknown as Parameters<typeof verifySettlementClaim>[2],
      ),
    ).rejects.toThrow("already settled");
    expect((await claim(request({}), context(id))).status).toBe(409);
  },
  60000,
);
