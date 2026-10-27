import { beforeEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isAddressEqual, recoverTypedDataAddress } from "viem";
import { initialState, isPaidVictory, BOSS_ENCOUNTER } from "../../game/rules";
import {
  settlementClasses,
  settlementResultTypes,
} from "../../apps/web/src/lib/settlement";
import {
  createSignerHandler,
  type SignerDependencies,
} from "../../supabase/functions/settlement-signer/handler";
import {
  classes,
  parseResult,
  resultTypes,
  type ChainEvidence,
} from "../../supabase/functions/settlement-signer/policy";
vi.mock("server-only", () => ({}));
import {
  serializeResult,
  signSettlement,
} from "../../apps/web/src/server/settlement-signer";

const signer = privateKeyToAccount(generatePrivateKey());
const policy = {
  contract: "0x3333333333333333333333333333333333333333",
  token: "0x4444444444444444444444444444444444444444",
  pool: "0x5555555555555555555555555555555555555555",
  signer: signer.address,
} as const;
const player = "0x6666666666666666666666666666666666666666";
const owner = "0x7777777777777777777777777777777777777777";
const serviceToken = "fixture-only-service-credential-32-characters";
const prepared = {
  domain: {
    name: "LanternValeSettlement",
    version: "1",
    chainId: 11155111,
    verifyingContract: policy.contract,
  } as const,
  types: resultTypes,
  primaryType: "Result" as const,
  message: {
    roundId: 7n,
    player,
    deposited: 10n ** 18n,
    won: true,
    fullClear: false,
    deadline: 13600n,
  },
} as const;
let round: ReturnType<typeof fixtureRound>;
let chain: ChainEvidence;
let deps: SignerDependencies;
function fixtureRound() {
  const state = initialState("warrior", false);
  Object.assign(state, {
    phase: "victory",
    encounter: 5,
    enemyHp: 0,
    cleared: [5],
  });
  return {
    chain_id: 11155111,
    gateway_address: policy.contract,
    contract_round_id: "7",
    wallet_address: player,
    economy_version: "settlement-v1",
    class: "warrior",
    state,
  };
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  round = fixtureRound();
  chain = {
    ...policy,
    chainId: 11155111,
    timestamp: 10000n,
    blockHash: `0x${"ab".repeat(32)}`,
    poolToken: policy.token,
    owner,
    tokenOwner: owner,
    player,
    deposited: 10n ** 18n,
    settled: false,
    classId: 0,
  };
  deps = {
    enabled: true,
    token: serviceToken,
    policy,
    now: () => 10000,
    loadRound: vi.fn(async () => round),
    readChain: vi.fn(async () => chain),
    recheck: vi.fn(async () => {}),
    sign: vi.fn((result) => signer.signTypedData(result)),
  };
});
function request(
  body: unknown = serializeResult(prepared),
  headers: Record<string, string> = {},
) {
  return new Request("https://signer.invalid/settlement", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
it("matches the application protocol and derives a verifiable signature from persisted evidence", async () => {
  expect(resultTypes).toEqual(settlementResultTypes);
  expect(classes).toEqual(settlementClasses);
  expect(BOSS_ENCOUNTER).toBe(5);
  expect(isPaidVictory(round.state)).toBe(true);
  const response = await createSignerHandler(deps)(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  const { signature } = await response.json();
  expect(
    isAddressEqual(
      await recoverTypedDataAddress({ ...prepared, signature }),
      signer.address,
    ),
  ).toBe(true);
  expect(deps.recheck).toHaveBeenCalledWith(chain);
});
it("works through the actual web adapter without exposing a generic signing method", async () => {
  vi.stubEnv("SETTLEMENT_SIGNER_URL", "https://signer.invalid/settlement");
  vi.stubEnv("SETTLEMENT_SIGNER_TOKEN", serviceToken);
  const handler = createSignerHandler(deps);
  vi.stubGlobal("fetch", (url: URL, init: RequestInit) =>
    handler(new Request(url, init)),
  );
  expect(await signSettlement(prepared, signer.address)).toBe(
    await signer.signTypedData(prepared),
  );
});
it("keeps the disabled service inert and authenticates before reading state", async () => {
  const disabled = createSignerHandler({ ...deps, enabled: false });
  expect((await disabled(request())).status).toBe(503);
  const handler = createSignerHandler(deps);
  for (const value of [
    "",
    "Bearer wrong",
    `Bearer ${serviceToken.slice(0, -1)}x`,
  ])
    expect(
      (await handler(request(undefined, { Authorization: value }))).status,
    ).toBe(401);
  expect(deps.loadRound).not.toHaveBeenCalled();
  expect(deps.sign).not.toHaveBeenCalled();
});
it("rejects browser origins, queries, other methods, encodings and malformed or oversized bodies", async () => {
  const handler = createSignerHandler(deps);
  const bad = [
    new Request("https://signer.invalid/settlement"),
    new Request("https://signer.invalid/settlement?key=anything", request()),
    request(undefined, { Origin: "https://app.invalid" }),
    request(undefined, { "Content-Type": "text/plain" }),
    request(undefined, { "Content-Encoding": "gzip" }),
    request("{"),
    request("x".repeat(4097)),
  ];
  for (const item of bad)
    expect((await handler(item)).status).toBeGreaterThanOrEqual(400);
  expect(deps.sign).not.toHaveBeenCalled();
  expect(deps.loadRound).not.toHaveBeenCalled();
});
it("rejects alternate domains, signing structures, uint overflow and unexpected fields", async () => {
  const original = serializeResult(prepared);
  const values = [
    { ...original, domain: { ...original.domain, chainId: 1 } },
    { ...original, domain: { ...original.domain, verifyingContract: player } },
    { ...original, domain: { ...original.domain, name: "Other" } },
    { ...original, types: { Result: [...original.types.Result].reverse() } },
    { ...original, primaryType: "Transfer" },
    { ...original, message: { ...original.message, deposited: "1" } },
    {
      ...original,
      message: { ...original.message, roundId: (2n ** 256n).toString() },
    },
    { ...original, message: { ...original.message, roundId: 7 } },
    { ...original, message: { ...original.message, roundId: "07" } },
    {
      ...original,
      message: { ...original.message, won: false, fullClear: true },
    },
    {
      ...original,
      message: { ...original.message, player: `0x${"0".repeat(40)}` },
    },
    { ...original, signature: "caller-selected" },
  ];
  for (const value of values)
    expect((await createSignerHandler(deps)(request(value))).status).toBe(400);
  expect(deps.sign).not.toHaveBeenCalled();
});
it("cancels a stalled authenticated request without accepting its valid JSON prefix", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(JSON.stringify(serializeResult(prepared))),
      );
    },
  });
  const stalled = new Request("https://signer.invalid/settlement", {
    method: "POST",
    body,
    duplex: "half",
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
    },
  } as RequestInit);
  expect((await createSignerHandler(deps)(stalled)).status).toBe(400);
  expect(deps.sign).not.toHaveBeenCalled();
});
it.each([
  [
    "practice",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.mode = "practice";
    },
  ],
  [
    "demo",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.demo = true;
    },
  ],
  [
    "nonterminal",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.phase = "trail";
    },
  ],
  [
    "no boss",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.cleared = [];
    },
  ],
  [
    "living boss",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.enemyHp = 1;
    },
  ],
  [
    "wrong class",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.classId = "thief";
    },
  ],
  [
    "wrong amount",
    (r: ReturnType<typeof fixtureRound>) => {
      r.state.spent = 2;
    },
  ],
  [
    "another recipient",
    (r: ReturnType<typeof fixtureRound>) => {
      r.wallet_address = owner;
    },
  ],
  [
    "legacy",
    (r: ReturnType<typeof fixtureRound>) => {
      r.economy_version = "legacy";
    },
  ],
])("rejects %s authoritative state without signing", async (_label, modify) => {
  modify(round);
  expect((await createSignerHandler(deps)(request())).status).toBe(503);
  expect(deps.sign).not.toHaveBeenCalled();
});
it("only signs full-clear and loss outcomes when the authoritative state agrees", async () => {
  const full = {
    ...prepared,
    message: { ...prepared.message, fullClear: true },
  };
  expect(
    (await createSignerHandler(deps)(request(serializeResult(full)))).status,
  ).toBe(503);
  round.state.cleared = [0, 1, 2, 3, 4, 5];
  expect(
    (await createSignerHandler(deps)(request(serializeResult(full)))).status,
  ).toBe(200);
  round.state.phase = "defeat";
  round.state.hp = 0;
  const loss = { ...prepared, message: { ...prepared.message, won: false } };
  expect(
    (await createSignerHandler(deps)(request(serializeResult(loss)))).status,
  ).toBe(200);
  expect((await createSignerHandler(deps)(request())).status).toBe(503);
});
it("rejects stale, settled, rotated, owner-key, wrong-chain and misconfigured escrow evidence", async () => {
  for (const change of [
    { chainId: 1 },
    { timestamp: 9800n },
    { timestamp: 10031n },
    { settled: true },
    { token: player },
    { pool: player },
    { poolToken: player },
    { signer: owner },
    { owner: signer.address },
    { tokenOwner: signer.address },
    { player: owner },
    { deposited: 2n * 10n ** 18n },
    { classId: 5 },
  ]) {
    deps.readChain = vi.fn(async () => ({ ...chain, ...change }));
    expect((await createSignerHandler(deps)(request())).status).toBe(503);
  }
  expect(deps.sign).not.toHaveBeenCalled();
});
it("bounds signature lifetime relative to the confirmed block", async () => {
  for (const deadline of ["10000", "10059", "13661"]) {
    const value = serializeResult(prepared);
    value.message.deadline = deadline;
    expect((await createSignerHandler(deps)(request(value))).status).toBe(503);
  }
  expect(deps.sign).not.toHaveBeenCalled();
});
it("returns only a sanitized failure after outages, reorgs and authority changes", async () => {
  for (const operation of [
    "loadRound",
    "readChain",
    "sign",
    "recheck",
  ] as const) {
    const failing = {
      ...deps,
      [operation]: vi.fn(async () => {
        throw new Error("private diagnostic and credentials");
      }),
    };
    const response = await createSignerHandler(failing)(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(
      '{"error":"Settlement signing is unavailable."}',
    );
  }
});
it("parses only canonical decimal amounts without floating-point conversion", () => {
  const value = serializeResult(prepared);
  value.message.deposited = "9007199254740991000000000000000000";
  expect(parseResult(value, policy.contract).message.deposited).toBe(
    9007199254740991n * 10n ** 18n,
  );
});
