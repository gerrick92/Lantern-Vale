import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { canUseGlow } from "../../apps/web/src/server/economy-access";
import { isDeveloperAccount } from "../../apps/web/src/server/developer-policy";
afterEach(() => vi.unstubAllEnvs());
it("enables the actual GLOW game for ordinary players in development and production", () => {
  vi.stubEnv("DEVELOPER_USER_ID", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("GLOW_ACCEPTANCE_ENABLED", "false");
  for (const mode of ["development", "production"]) {
    vi.stubEnv("NODE_ENV", mode);
    expect(canUseGlow()).toBe(true);
    for (const id of [
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ])
      expect(isDeveloperAccount(id)).toBe(false);
  }
});
it("does not require a configured developer or tester list for GLOW play", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEVELOPER_USER_ID", "");
  vi.stubEnv("GLOW_ACCEPTANCE_ENABLED", "");
  expect(canUseGlow()).toBe(true);
  expect(isDeveloperAccount("00000000-0000-4000-8000-000000000001")).toBe(
    false,
  );
});
