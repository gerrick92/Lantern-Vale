import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-config", () => ({
  authConfigured: true,
  authConfig: { url: "https://auth.example.test", key: "fixture-public-key" },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: mocks }),
}));

import {
  canAccessDeveloperTools,
  requireDeveloperPage,
} from "@/server/developer-access";
import { proxy } from "@/proxy";

const owner = "11111111-1111-4111-8111-111111111111";
const user = {
  id: owner,
  email_confirmed_at: "2026-10-22T10:00:00Z",
  factors: [{ factor_type: "totp", status: "verified" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DEVELOPER_USER_ID", owner);
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: owner, aal: "aal2" } },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

async function expectDenied() {
  expect(await canAccessDeveloperTools()).toBe(false);
  await expect(requireDeveloperPage()).rejects.toThrow("NEXT_NOT_FOUND");
  for (const path of [
    "/dev/deploy",
    "/dev/deploy/game",
    "/dev/deploy/game/verify",
    "/dev/play",
    "/dev/future-tool",
  ]) {
    const response = await proxy(
      new NextRequest("http://127.0.0.1:3000" + path),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
}

it("allows only the configured verified account through both server guards", async () => {
  expect(await canAccessDeveloperTools()).toBe(true);
  await expect(requireDeveloperPage()).resolves.toBeUndefined();
  const response = await proxy(
    new NextRequest("http://127.0.0.1:3000/dev/deploy"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it.each(["production", "test"])("denies the owner in %s", async (mode) => {
  vi.stubEnv("NODE_ENV", mode);
  await expectDenied();
  expect(mocks.getUser).not.toHaveBeenCalled();
});

it.each([undefined, "", "*", "not-a-user-id", owner + ",another-user"])(
  "fails closed with invalid developer configuration %s",
  async (value) => {
    vi.stubEnv("DEVELOPER_USER_ID", value);
    await expectDenied();
  },
);

it("denies another verified account even with owner-like editable metadata", async () => {
  const id = "22222222-2222-4222-8222-222222222222";
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        ...user,
        id,
        user_metadata: { role: "admin", developer: true, userId: owner },
      },
    },
  });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: id, aal: "aal2" } },
  });
  await expectDenied();
});

it("denies guests, unverified email, missing MFA and mismatched claims", async () => {
  for (const invalidUser of [
    null,
    { ...user, email_confirmed_at: null },
    { ...user, factors: [] },
  ]) {
    mocks.getUser.mockResolvedValue({ data: { user: invalidUser } });
    await expectDenied();
  }
  mocks.getUser.mockResolvedValue({ data: { user } });
  for (const claims of [
    { sub: owner, aal: "aal1" },
    { sub: "another-account", aal: "aal2" },
  ]) {
    mocks.getClaims.mockResolvedValue({ data: { claims } });
    await expectDenied();
  }
});
