import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gameDeploymentFixture } from "../helpers/game-deployment";

const f = vi.hoisted(() => ({
  allowed: true,
  load: vi.fn(),
  rpc: undefined as unknown,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/developer-access", () => ({
  canAccessDeveloperTools: async () => f.allowed,
}));
vi.mock("@/server/game-deployment", () => ({
  loadGameDeploymentReview: f.load,
}));
vi.mock("@/server/blockchain", () => ({ chainClient: () => f.rpc }));
import { POST } from "../../apps/web/src/app/dev/deploy/game/verify/route";

const request = (body: unknown, origin = "http://127.0.0.1:3000") =>
  new Request(`${origin}/dev/deploy/game/verify`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  f.allowed = true;
});
afterEach(() => vi.unstubAllEnvs());

it("authenticates before reading files, parsing input or making RPC calls", async () => {
  f.allowed = false;
  const response = await POST(request({ deploymentHash: "invalid" }));
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(f.load).not.toHaveBeenCalled();
});

it("returns a verified report only for the owner guard, same origin and exact current plan", async () => {
  const fixture = gameDeploymentFixture(true);
  f.load.mockResolvedValue(fixture);
  f.rpc = fixture.rpc;
  const body = { fingerprint: fixture.plan.fingerprint, ...fixture.hashes };
  const response = await POST(request(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "PASS",
    stage: "PAUSED_AND_FUNDED",
    paidPlayEnabled: false,
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  fixture.mock.getChainId.mockClear();
  expect(
    (await POST(request({ ...body, fingerprint: "0".repeat(64) }))).status,
  ).toBe(409);
  expect(fixture.mock.getChainId).not.toHaveBeenCalled();
});

it("rejects cross-origin, arbitrary fields, missing hashes and oversized input before RPC", async () => {
  const fixture = gameDeploymentFixture();
  const body = { fingerprint: fixture.plan.fingerprint, ...fixture.hashes };
  expect((await POST(request(body, "https://attacker.example"))).status).toBe(
    403,
  );
  for (const value of [
    { ...body, owner: fixture.plan.owner },
    { ...body, deploymentHash: "0x1234" },
    { fingerprint: body.fingerprint },
    { ...body, padding: "x".repeat(20_000) },
  ])
    expect((await POST(request(value))).status).toBeGreaterThanOrEqual(400);
  expect(f.load).not.toHaveBeenCalled();
});

it("does not expose credential-bearing RPC errors or accept mismatched receipts", async () => {
  const fixture = gameDeploymentFixture();
  f.load.mockResolvedValue(fixture);
  f.rpc = fixture.rpc;
  fixture.mock.getChainId.mockRejectedValue(
    new Error("https://private-rpc.invalid/credential-do-not-show"),
  );
  const response = await POST(
    request({ fingerprint: fixture.plan.fingerprint, ...fixture.hashes }),
  );
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("credential-do-not-show");
  fixture.mock.getChainId.mockResolvedValue(11155111);
  fixture.tx.value = 1n;
  const rejected = await POST(
    request({ fingerprint: fixture.plan.fingerprint, ...fixture.hashes }),
  );
  expect(rejected.status).toBe(409);
  expect(await rejected.text()).toContain("Receipt does not match");
});
