import { beforeEach, expect, it, vi } from "vitest";
const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock("@/server/auth", () => ({
  sessionClient: async () => ({ auth: { exchangeCodeForSession: exchange } }),
}));
vi.mock("@/server/http", () => ({ appOrigin: () => "http://127.0.0.1:3000" }));
import { GET } from "../../apps/web/src/app/auth/callback/route";
beforeEach(() => exchange.mockReset());
it("handles rejected account callbacks without exposing provider details", async () => {
  for (const [error, reason] of [
    ["access_denied", "sign-in-cancelled"],
    ["server_error", "sign-in-failed"],
  ]) {
    const result = await GET(
      new Request(
        `http://127.0.0.1:3000/auth/callback?error=${error}&error_description=private-detail&code=ignored&next=https://untrusted.example`,
      ),
    );
    expect(result.headers.get("location")).toBe(
      `http://127.0.0.1:3000/auth?error=${reason}`,
    );
  }
  expect(exchange).not.toHaveBeenCalled();
});
it("rejects oversized callback codes without calling the identity provider", async () => {
  const result = await GET(
    new Request("http://127.0.0.1:3000/auth/callback?code=" + "x".repeat(2049)),
  );
  expect(result.headers.get("location")).toContain("error=expired-link");
  expect(exchange).not.toHaveBeenCalled();
});
it("routes an exchanged recovery session to Settings using the provider result", async () => {
  exchange.mockResolvedValue({
    data: { session: {}, user: {}, redirectType: "recovery" },
    error: null,
  });
  const result = await GET(
    new Request("http://127.0.0.1:3000/auth/callback?code=test-code"),
  );
  expect(result.headers.get("location")).toBe("http://127.0.0.1:3000/settings");
});
it("keeps normal confirmation inside the app and ignores caller-provided redirect URLs", async () => {
  exchange.mockResolvedValue({
    data: { session: {}, user: {}, redirectType: null },
    error: null,
  });
  const result = await GET(
    new Request(
      "http://127.0.0.1:3000/auth/callback?code=test-code&next=https://untrusted.example",
    ),
  );
  expect(result.headers.get("location")).toBe(
    "http://127.0.0.1:3000/dashboard",
  );
});
it("does not expose provider errors or accept a missing or invalid code", async () => {
  exchange.mockResolvedValue({
    data: null,
    error: new Error("Private provider detail"),
  });
  for (const query of ["", "?code=invalid-code"]) {
    const result = await GET(
      new Request("http://127.0.0.1:3000/auth/callback" + query),
    );
    expect(result.headers.get("location")).toBe(
      "http://127.0.0.1:3000/auth?error=expired-link",
    );
  }
});
