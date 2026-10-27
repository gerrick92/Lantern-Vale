import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  access: true,
  paused: true,
  chain: 11155111,
  read: vi.fn(),
  verify: vi.fn(),
  code: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/developer-access", () => ({
  canAccessDeveloperTools: async () => f.access,
}));
const owner = "0x" + "11".repeat(20),
  signer = "0x" + "22".repeat(20),
  token = "0x" + "33".repeat(20),
  faucet = "0x" + "44".repeat(20),
  economy = "0x" + "55".repeat(20);
vi.mock("@/server/game-deployment", () => ({
  loadGameDeploymentReview: async () => ({
    plan: { owner, signer, token, faucet },
    artifact: {},
  }),
}));
vi.mock("node:fs/promises", () => ({
  readFile: async () =>
    JSON.stringify({
      economy,
      deploymentHash: "0x" + "aa".repeat(32),
      fundingHash: "0x" + "bb".repeat(32),
    }),
}));
vi.mock("@/features/deployment/game-verification", () => ({
  verifyGameRuntime: (...args: unknown[]) => f.code(...args),
  verifyGameDeployment: (...args: unknown[]) => f.verify(...args),
}));
vi.mock("@/server/blockchain", () => ({
  chainClient: () => ({
    getChainId: async () => f.chain,
    getCode: async () => "0x1234",
    readContract: f.read,
  }),
}));
import { POST } from "../../apps/web/src/app/dev/deploy/game/activation/route";
const request = (origin = "http://127.0.0.1:3000", body = {}) =>
  new Request(origin + "/dev/deploy/game/activation", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  f.access = true;
  f.paused = true;
  f.chain = 11155111;
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  vi.stubEnv("GLOW_ACCEPTANCE_ENABLED", "true");
  vi.stubEnv("SEPOLIA_GAME_ECONOMY_ADDRESS", economy);
  vi.stubEnv("SETTLEMENT_SIGNER_URL", "https://fixture.invalid/sign");
  vi.stubEnv("SETTLEMENT_SIGNER_TOKEN", "synthetic-fixture-token");
  f.read.mockImplementation(async ({ functionName }) =>
    functionName === "paused"
      ? f.paused
      : { owner, signer, token, recyclingPool: faucet }[
          functionName as "owner"
        ],
  );
  f.fetch.mockResolvedValue(
    Response.json({ error: "Invalid settlement result." }, { status: 400 }),
  );
  vi.stubGlobal("fetch", f.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("prepares only zero-value unpause after independent funded deployment and signer checks", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    chainId: 11155111,
    owner,
    to: economy,
    paused: true,
    data: "0x3f4ba83a",
    value: "0",
  });
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.code).toHaveBeenCalledOnce();
});
it("denies guests, other origins, caller-selected transactions and disabled acceptance", async () => {
  f.access = false;
  expect((await POST(request())).status).toBe(404);
  f.access = true;
  expect((await POST(request("https://unrelated.invalid"))).status).toBe(403);
  expect((await POST(request(undefined, { to: owner }))).status).toBe(400);
  vi.stubEnv("GLOW_ACCEPTANCE_ENABLED", "false");
  expect((await POST(request())).status).toBe(503);
  expect(f.read).not.toHaveBeenCalled();
});
it("fails closed for wrong network, altered authority, code mismatch and disabled signer", async () => {
  f.chain = 1;
  expect((await POST(request())).status).toBe(409);
  f.chain = 11155111;
  f.read.mockResolvedValueOnce(token);
  expect((await POST(request())).status).toBe(409);
  f.code.mockImplementationOnce(() => {
    throw Error("Mismatch");
  });
  expect((await POST(request())).status).toBe(500);
  f.fetch.mockResolvedValueOnce(
    Response.json({ error: "Signing is disabled." }, { status: 503 }),
  );
  expect((await POST(request())).status).toBe(503);
});
