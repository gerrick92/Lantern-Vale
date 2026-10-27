import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { configuredHandler } from "../../supabase/functions/settlement-signer/runtime";
import { resultTypes } from "../../supabase/functions/settlement-signer/policy";
const rpc = vi.hoisted(() => ({
  getChainId: vi.fn(),
  getBlockNumber: vi.fn(),
  getBlock: vi.fn(),
  readContract: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<object>()),
  createPublicClient: () => rpc,
}));
const key = generatePrivateKey();
const signer = privateKeyToAccount(key);
const contract = "0x3333333333333333333333333333333333333333";
const token = "0x4444444444444444444444444444444444444444";
const pool = "0x5555555555555555555555555555555555555555";
const player = "0x6666666666666666666666666666666666666666";
const owner = "0x7777777777777777777777777777777777777777";
const blockHash = `0x${"ab".repeat(32)}`;
const credential = "fixture-service-token-with-at-least-32-characters";
let values: Record<string, string>;
let record: Record<string, unknown>;
let now: bigint;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  now = BigInt(Math.floor(Date.now() / 1000));
  values = {
    LV_SIGNING_ENABLED: "true",
    LV_SIGNER_PRIVATE_KEY: key,
    LV_SIGNER_TOKEN: credential,
    LV_ECONOMY_ADDRESS: contract,
    LV_TOKEN_ADDRESS: token,
    LV_FAUCET_ADDRESS: pool,
    LV_SEPOLIA_RPC_URL: "https://rpc.invalid",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-db-key",
  };
  record = {
    chain_id: 11155111,
    gateway_address: contract,
    contract_round_id: "7",
    wallet_address: player,
    economy_version: "settlement-v1",
    class: "warrior",
    rulesVersion: 5,
    mode: "paid",
    demo: false,
    phase: "victory",
    classId: "warrior",
    hp: 100,
    enemyHp: 0,
    encounter: 5,
    cleared: [5],
    spent: 1,
  };
  rpc.getChainId.mockResolvedValue(11155111);
  rpc.getBlockNumber.mockResolvedValue(100n);
  rpc.getBlock.mockResolvedValue({
    number: 99n,
    hash: blockHash,
    timestamp: now,
  });
  rpc.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === "rounds") return [player, 10n ** 18n, 0, false, 0];
      if (functionName === "signer") return signer.address;
      if (functionName === "token") return token;
      if (functionName === "owner") return owner;
      if (functionName === "recyclingPool") return pool;
      throw new Error("Unexpected fixture call");
    },
  );
  fetcher = vi.fn(async (url) =>
    String(url).includes("game_round_recovery_ready")
      ? Response.json(true)
      : Response.json([record]),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
function request() {
  return new Request("https://function.invalid/settlement-signer", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domain: {
        name: "LanternValeSettlement",
        version: "1",
        chainId: 11155111,
        verifyingContract: contract,
      },
      types: resultTypes,
      primaryType: "Result",
      message: {
        roundId: "7",
        player,
        deposited: (10n ** 18n).toString(),
        won: true,
        fullClear: false,
        deadline: (now + 3600n).toString(),
      },
    }),
  });
}
it("does not read a key or connect to a service unless explicitly enabled", async () => {
  const env = vi.fn(() => undefined);
  const handler = configuredHandler(env);
  expect((await handler(request())).status).toBe(503);
  expect(env.mock.calls).toEqual([["LV_SIGNING_ENABLED"], ["LV_SIGNER_TOKEN"]]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(rpc.getChainId).not.toHaveBeenCalled();
});
it("verifies service isolation while disabled without accessing the key, database or RPC", async () => {
  const env = vi.fn((name: string) => {
    if (name === "LV_SIGNING_ENABLED") return "false";
    if (name === "LV_SIGNER_TOKEN") return credential;
    throw new Error("Disabled signing must not read protected configuration");
  });
  const handler = configuredHandler(env);
  const anonymous = request();
  anonymous.headers.delete("authorization");
  expect((await handler(anonymous)).status).toBe(401);
  const wrong = request();
  wrong.headers.set("authorization", `Bearer ${"x".repeat(credential.length)}`);
  expect((await handler(wrong)).status).toBe(401);
  const browser = request();
  browser.headers.set("origin", "https://example.com");
  expect((await handler(browser)).status).toBe(400);
  const allowed = await handler(request());
  expect(allowed.status).toBe(503);
  expect(await allowed.json()).toEqual({ error: "Signing is disabled." });
  expect(fetcher).not.toHaveBeenCalled();
  expect(rpc.getChainId).not.toHaveBeenCalled();
});
it("queries only the pinned round and terminal projection, signs, and rechecks canonical authority", async () => {
  const handler = configuredHandler((name) => values[name]);
  const response = await handler(request());
  expect(response.status).toBe(200);
  const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
  expect(url.hostname).toBe("abcdefghijklmnopqrst.supabase.co");
  expect(url.searchParams.get("gateway_address")).toBe(`eq.${contract}`);
  expect(url.searchParams.get("contract_round_id")).toBe("eq.7");
  expect(url.searchParams.get("chain_id")).toBe("eq.11155111");
  expect(url.searchParams.get("select")).toContain("phase:state->phase");
  expect(url.searchParams.get("select")).not.toMatch(/ledger|log|user_id/);
  expect(options.redirect).toBe("error");
  expect(options.cache).toBe("no-store");
  const { signature } = await response.json();
  const body = await request().json();
  body.message.roundId = 7n;
  body.message.deposited = 10n ** 18n;
  body.message.deadline = now + 3600n;
  expect(await recoverTypedDataAddress({ ...body, signature })).toBe(
    signer.address,
  );
  expect(rpc.getBlock).toHaveBeenCalledWith({ blockNumber: 99n });
  expect(rpc.getBlock).toHaveBeenCalledWith({ blockHash });
});
it("fails closed for a rotated signer and a reorg between verification and response", async () => {
  const original = rpc.readContract.getMockImplementation()!;
  let signerReads = 0;
  rpc.readContract.mockImplementation(async (args) => {
    if (args.functionName === "signer" && ++signerReads === 2) return owner;
    return original(args);
  });
  expect(
    (await configuredHandler((name) => values[name])(request())).status,
  ).toBe(503);
  rpc.readContract.mockImplementation(original);
  rpc.getBlock
    .mockResolvedValueOnce({ number: 99n, hash: blockHash, timestamp: now })
    .mockResolvedValueOnce({ number: 99n, hash: blockHash, timestamp: now })
    .mockResolvedValueOnce({
      number: 99n,
      hash: `0x${"cd".repeat(32)}`,
      timestamp: now,
    });
  expect(
    (await configuredHandler((name) => values[name])(request())).status,
  ).toBe(503);
});
it("refuses results whose authoritative game history has not been retained", async () => {
  fetcher.mockImplementation(async (url) =>
    String(url).includes("game_round_recovery_ready")
      ? Response.json(false)
      : Response.json([record]),
  );
  const response = await configuredHandler((name) => values[name])(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("signature");
});
it("rejects missing, duplicate, malformed and oversized state without leaking upstream data", async () => {
  for (const body of [
    [],
    [record, record],
    [null],
    [{ ...record, mode: "practice" }],
    "private".repeat(40000),
  ]) {
    fetcher.mockImplementationOnce(async () => Response.json(body));
    const response = await configuredHandler((name) => values[name])(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      '{"error":"Settlement signing is unavailable."}',
    );
  }
});
it("rejects endpoint credentials, redirects and wrong-chain transports", async () => {
  for (const url of [
    "http://rpc.invalid",
    "https://user:password@rpc.invalid",
    "https://rpc.invalid?key=value",
  ]) {
    expect(() =>
      configuredHandler((name) =>
        name === "LV_SEPOLIA_RPC_URL" ? url : values[name],
      ),
    ).toThrow();
  }
  expect(() =>
    configuredHandler((name) =>
      name === "SUPABASE_URL" ? "https://unrelated.invalid" : values[name],
    ),
  ).toThrow();
  rpc.getChainId.mockResolvedValue(1);
  expect(
    (await configuredHandler((name) => values[name])(request())).status,
  ).toBe(503);
});
