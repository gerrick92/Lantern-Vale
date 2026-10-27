export function authenticatorEnrollmentUri(
  secret: string,
  source: string,
): string {
  // Enrollment material stays in component memory and must never enter logs.
  try {
    const uri = new URL(source);
    if (
      uri.protocol !== "otpauth:" ||
      uri.hostname !== "totp" ||
      !/^[A-Z2-7]+=*$/i.test(secret) ||
      uri.searchParams.get("secret") !== secret ||
      !["SHA1", null].includes(
        uri.searchParams.get("algorithm")?.toUpperCase() ?? null,
      ) ||
      !["6", null].includes(uri.searchParams.get("digits")) ||
      !["30", null].includes(uri.searchParams.get("period"))
    )
      throw new Error();
    return uri.toString();
  } catch {
    throw new Error(
      "The authenticator setup data could not be read. Please try setup again.",
    );
  }
}
