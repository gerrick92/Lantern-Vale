import { expect, it } from "vitest";
import { authenticatorEnrollmentUri } from "../../apps/web/src/lib/auth-qr";
const secret = "JBSWY3DPEHPK3PXP";
const uri =
  "otpauth://totp/Lantern%20Vale:test?secret=" +
  secret +
  "&issuer=Lantern%20Vale";
it("uses a matching standard TOTP enrollment URI without leaking it in errors", () => {
  expect(authenticatorEnrollmentUri(secret, uri)).toBe(uri);
  for (const source of [
    uri.replace(secret, "AAAA"),
    uri + "&digits=8",
    "https://example.invalid/?secret=" + secret,
    uri + "&period=60",
  ]) {
    expect(() => authenticatorEnrollmentUri(secret, source)).toThrow(
      "setup data could not be read",
    );
    try {
      authenticatorEnrollmentUri(secret, source);
    } catch (e) {
      expect(String(e)).not.toContain(secret);
    }
  }
});
