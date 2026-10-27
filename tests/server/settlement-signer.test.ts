import { afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { settlementResultTypes } from "../../apps/web/src/lib/settlement";
vi.mock("server-only", () => ({}));
import {
  signSettlement,
  serializeResult,
  type PreparedResult,
} from "../../apps/web/src/server/settlement-signer";
const signer = privateKeyToAccount(generatePrivateKey());
const prepared: PreparedResult = {
  domain: {
    name: "LanternValeSettlement",
    version: "1",
    chainId: 11155111,
    verifyingContract: "0x3333333333333333333333333333333333333333",
  },
  types: settlementResultTypes,
  primaryType: "Result",
  message: {
    roundId: 7n,
    player: "0x4444444444444444444444444444444444444444",
    deposited: 8n * 10n ** 18n,
    won: true,
    fullClear: false,
    deadline: 10000n,
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function configure() {
  vi.stubEnv("SETTLEMENT_SIGNER_URL", "https://signer.invalid/settlement");
  vi.stubEnv("SETTLEMENT_SIGNER_TOKEN", "test-only-service-credential");
}
it("fails closed without provisioning and never accepts plaintext or credential-bearing URLs", async () => {
  vi.stubEnv("SETTLEMENT_SIGNER_URL", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(signSettlement(prepared, signer.address)).rejects.toThrow(
    "not provisioned",
  );
  configure();
  for (const url of [
    "http://signer.invalid",
    "https://user:password@signer.invalid",
    "https://signer.invalid?secret=value",
  ]) {
    vi.stubEnv("SETTLEMENT_SIGNER_URL", url);
    await expect(signSettlement(prepared, signer.address)).rejects.toThrow(
      "configuration",
    );
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it("verifies the exact domain, recipient, deposits and active signer before returning a signature", async () => {
  configure();
  const signature = await signer.signTypedData(prepared);
  const fetcher = vi.fn(async () => Response.json({ signature }));
  vi.stubGlobal("fetch", fetcher);
  expect(await signSettlement(prepared, signer.address)).toBe(signature);
  const options = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(JSON.parse(options[1].body as string)).toEqual(
    serializeResult(prepared),
  );
  expect(options[1].redirect).toBe("error");
  await expect(
    signSettlement(
      { ...prepared, message: { ...prepared.message, deposited: 9n } },
      signer.address,
    ),
  ).rejects.toThrow("invalid signature");
  await expect(
    signSettlement(prepared, privateKeyToAccount(generatePrivateKey()).address),
  ).rejects.toThrow("invalid signature");
});
it("bounds responses and reports outages without exposing the service response or credential", async () => {
  configure();
  for (const response of [
    new Response("private upstream diagnostic", { status: 500 }),
    new Response("a".repeat(3000)),
    Response.json({ signature: "bad" }),
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await expect(signSettlement(prepared, signer.address)).rejects.toThrow(
      "temporarily unavailable",
    );
  }
});
