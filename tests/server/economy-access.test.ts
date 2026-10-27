import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const release = vi.hoisted(() => ({ ready: false }));
vi.mock("@/lib/economy-release", () => ({
  get paidEconomyReady() {
    return release.ready;
  },
}));
import { canUseGlow } from "../../apps/web/src/server/economy-access";
import { isDeveloperAccount } from "../../apps/web/src/server/developer-policy";
const owner = "00000000-0000-4000-8000-000000000001";
afterEach(() => {
  vi.unstubAllEnvs();
  release.ready = false;
});
it("public game eligibility does not grant developer privileges to ordinary players", () => {
  release.ready = true; // Test the release path without changing the application's closed gate.
  vi.stubEnv("DEVELOPER_USER_ID", owner);
  for (const mode of ["development", "production"]) {
    vi.stubEnv("NODE_ENV", mode);
    for (const id of [
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]) {
      expect(canUseGlow(id)).toBe(true);
      expect(isDeveloperAccount(id)).toBe(false);
    }
  }
});
it("restricts acceptance to the configured developer in a development server", () => {
  vi.stubEnv("DEVELOPER_USER_ID", owner);
  vi.stubEnv("GLOW_ACCEPTANCE_ENABLED", "true");
  vi.stubEnv("NODE_ENV", "development");
  expect(canUseGlow(owner)).toBe(true);
  expect(canUseGlow("00000000-0000-4000-8000-000000000002")).toBe(false);
  for (const mode of ["production", "test"]) {
    vi.stubEnv("NODE_ENV", mode);
    expect(canUseGlow(owner)).toBe(false);
  }
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("GLOW_ACCEPTANCE_ENABLED", "false");
  expect(canUseGlow(owner)).toBe(false);
});
