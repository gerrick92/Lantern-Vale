import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gameDeploymentFixture } from "../helpers/game-deployment";

const f = vi.hoisted(() => ({
  allowed: true,
  load: vi.fn(),
  read: vi.fn(),
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
vi.mock("node:fs/promises", () => ({ readFile: f.read }));
import { POST } from "../../apps/web/src/app/dev/deploy/game/prepare/route";

const request = (body: unknown, origin = "http://127.0.0.1:3000") =>
  new Request(`${origin}/dev/deploy/game/prepare`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  f.allowed = true;
  const fixture = gameDeploymentFixture();
  f.load.mockResolvedValue(fixture);
  f.rpc = fixture.rpc;
  f.read.mockResolvedValue(
    JSON.stringify({
      status: "PROVISIONED_DISABLED",
      signer: fixture.plan.signer,
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());

it("denies nonowners before reading files or input", async () => {
  f.allowed = false;
  expect((await POST(request({ bad: true }))).status).toBe(404);
  expect(f.load).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});
it("requires same origin, exact bounded schema and current fingerprint", async () => {
  const fixture = gameDeploymentFixture();
  const body = { fingerprint: fixture.plan.fingerprint };
  expect((await POST(request(body, "https://wrong.example"))).status).toBe(403);
  expect(
    (await POST(request({ ...body, to: fixture.plan.owner }))).status,
  ).toBe(400);
  expect((await POST(request({ fingerprint: "0".repeat(64) }))).status).toBe(
    409,
  );
  expect(f.read).not.toHaveBeenCalled();
});
it("prepares only exact constructor bytes after current onchain configuration checks", async () => {
  const fixture = gameDeploymentFixture();
  const response = await POST(
    request({ fingerprint: fixture.plan.fingerprint }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    step: "deploy",
    transaction: fixture.plan.deployment,
    verified: null,
  });
});
it.each([
  "missing",
  "wrong signer",
  "wrong owner",
  "wrong chain",
  "no capacity",
])("rejects preparation for %s", async (kind) => {
  const fixture = gameDeploymentFixture();
  f.load.mockResolvedValue(fixture);
  f.rpc = fixture.rpc;
  if (kind === "missing")
    f.read.mockRejectedValue(new Error("private file path"));
  if (kind === "wrong signer")
    f.read.mockResolvedValue(
      JSON.stringify({
        status: "PROVISIONED_DISABLED",
        signer: fixture.plan.owner,
      }),
    );
  if (kind === "wrong owner") fixture.states.owner = fixture.plan.signer;
  if (kind === "wrong chain") fixture.mock.getChainId.mockResolvedValue(1);
  if (kind === "no capacity") fixture.states.totalSupply = fixture.states.cap;
  const response = await POST(
    request({ fingerprint: fixture.plan.fingerprint }),
  );
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("private file path");
});
it("prepares funding only after independently verified creation and returns done after exact funding", async () => {
  for (const funded of [false, true]) {
    const fixture = gameDeploymentFixture(funded);
    f.load.mockResolvedValue(fixture);
    f.rpc = fixture.rpc;
    const response = await POST(
      request({ fingerprint: fixture.plan.fingerprint, ...fixture.hashes }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.step).toBe(funded ? "done" : "fund");
    expect(result.verified.paused).toBe(true);
    expect(result.verified.paidPlayEnabled).toBe(false);
    if (funded) expect(result.transaction).toBeNull();
    else
      expect(result.transaction).toMatchObject({
        from: fixture.plan.owner,
        to: fixture.plan.token,
        value: "0",
        data: fixture.fundingTx.input,
      });
  }
});
