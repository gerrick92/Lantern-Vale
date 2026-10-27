import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-config", () => ({
  authConfigured: true,
  authConfig: { url: "https://auth.example.test", key: "fixture-public-key" },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: mocks }),
}));

import { requireUser } from "../../apps/web/src/server/auth";

const user = {
  id: "account-a",
  email_confirmed_at: "2026-10-22T10:00:00Z",
  factors: [{ factor_type: "totp", status: "verified" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, aal: "aal2" } },
    error: null,
  });
});

it("rejects an absent or provider-rejected user before reading claims", async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user }, error: new Error("Expired session") },
  ]) {
    mocks.getUser.mockResolvedValue(result);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  }
  expect(mocks.getClaims).not.toHaveBeenCalled();
});

it("rejects an inactive account even when a valid MFA claim exists", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { ...user, email_confirmed_at: null } },
  });
  await expect(requireUser()).rejects.toMatchObject({ status: 403 });
});

it("rejects mismatched or unverifiable claim ownership", async () => {
  for (const result of [
    { data: { claims: { sub: "account-b", aal: "aal2" } } },
    { data: null, error: new Error("Invalid JWT") },
  ]) {
    mocks.getClaims.mockResolvedValue(result);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  }
});

it("requires both AAL2 and a currently verified authenticator", async () => {
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, aal: "aal1" } },
  });
  await expect(requireUser()).rejects.toMatchObject({ status: 403 });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, aal: "aal2" } },
  });
  for (const factors of [[], [{ factor_type: "totp", status: "unverified" }]]) {
    mocks.getUser.mockResolvedValue({ data: { user: { ...user, factors } } });
    await expect(requireUser()).rejects.toMatchObject({ status: 403 });
  }
});

it("returns the verified account for private access", async () => {
  await expect(requireUser()).resolves.toMatchObject({ user });
});

it("requires real TOTP after password login despite forged profile metadata", async () => {
  const player = {
    ...user,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { role: "developer", aal: "aal2" },
  };
  mocks.getUser.mockResolvedValue({
    data: { user: player },
    error: null,
  });
  mocks.getClaims.mockResolvedValue({
    data: {
      claims: { sub: user.id, aal: "aal1", amr: [{ method: "password" }] },
    },
    error: null,
  });
  await expect(requireUser()).rejects.toMatchObject({ status: 403 });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, aal: "aal2" } },
    error: null,
  });
  await expect(requireUser()).resolves.toMatchObject({ user: player });
  mocks.getUser.mockResolvedValue({
    data: { user: { ...player, factors: [] } },
    error: null,
  });
  await expect(requireUser()).rejects.toMatchObject({ status: 403 });
});

it("allows explicit enrollment access without bypassing account verification", async () => {
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, aal: "aal1" } },
  });
  mocks.getUser.mockResolvedValue({ data: { user: { ...user, factors: [] } } });
  await expect(requireUser(false)).resolves.toMatchObject({
    user: { id: user.id },
  });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: "account-b", aal: "aal1" } },
  });
  await expect(requireUser(false)).rejects.toMatchObject({ status: 401 });
});
