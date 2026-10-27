import { loadEnvFile } from "node:process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const staging = process.argv.includes("--staging");
loadEnvFile(staging ? "apps/web/.env.staging.local" : "apps/web/.env.local");
const project = staging ? "nisviqoxcfbtwccdjqoz" : "frbbhbkwtgqczdjfhedi";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(url, `https://${project}.supabase.co`);
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: "pkce",
  },
};
const client = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const admin = createClient(
  url,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const checks = [];
const record = (name) => {
  checks.push({ name, status: "PASS" });
  console.log(`PASS: ${name}`);
};
const checked = (result) => {
  if (result.error)
    throw new Error(
      `Service request failed (${result.error.code || "unknown"}).`,
    );
  return result.data;
};
const snapshot = async () => {
  const users = [];
  for (let page = 1; ; page++) {
    const data = checked(
      await admin.auth.admin.listUsers({ page, perPage: 100 }),
    );
    for (const user of data.users)
      users.push({
        id: user.id,
        factors: user.factors || [],
        email: user.email,
      });
    if (data.users.length < 100) break;
  }
  users.sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(users)).digest("hex");
};
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replaceAll("=", "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((part) => parseInt(part, 2)));
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(count).digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
let fixtureId;
let before;
try {
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
  });
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.equal(settings.mailer_autoconfirm, true);
  assert.equal(settings.external.email, true);
  assert.equal(settings.disable_signup, false);
  for (const provider of ["google", "azure", "github"])
    assert.notEqual(settings.external[provider], true);
  record(
    "Email/password signup is open; no confirmation mail or social provider required",
  );
  before = await snapshot();
  const email = `lantern-registration-${randomUUID()}@example.com`;
  const password = `Aa1!${randomBytes(24).toString("base64url")}`;
  const signup = checked(await client.auth.signUp({ email, password }));
  fixtureId = signup.user?.id;
  assert.ok(fixtureId && signup.session);
  assert.notEqual(fixtureId, process.env.DEVELOPER_USER_ID);
  assert.equal(
    checked(await client.auth.mfa.getAuthenticatorAssuranceLevel())
      .currentLevel,
    "aal1",
  );
  record(
    "Public signup creates an ordinary password account and an AAL1 session immediately",
  );
  const duplicate = await createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  ).auth.signUp({
    email,
    password: `Bb2!${randomBytes(24).toString("base64url")}`,
  });
  assert.ok(duplicate.error || !duplicate.data.session);
  record("Duplicate registration cannot take over the existing account");
  const factor = checked(
    await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Disposable registration check",
    }),
  );
  checked(
    await client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
  );
  assert.equal(
    checked(await client.auth.mfa.getAuthenticatorAssuranceLevel())
      .currentLevel,
    "aal2",
  );
  record(
    "Google Authenticator-compatible TOTP elevates the new account to AAL2",
  );
  checked(await client.auth.signOut());
  checked(await client.auth.signInWithPassword({ email, password }));
  const levels = checked(
    await client.auth.mfa.getAuthenticatorAssuranceLevel(),
  );
  assert.equal(levels.currentLevel, "aal1");
  assert.equal(levels.nextLevel, "aal2");
  record("Signing in again requires the existing authenticator");
} catch (error) {
  checks.push({
    name: "Registration verification",
    status: "FAIL",
    reason: error.code || "Check failed; no credentials logged",
  });
  console.error(
    "FAIL: registration verification did not complete; no credentials logged.",
  );
  process.exitCode = 1;
} finally {
  if (fixtureId) {
    const removed = await admin.auth.admin.deleteUser(fixtureId);
    if (removed.error) {
      checks.push({ name: "Fixture cleanup", status: "FAIL", fixtureId });
      process.exitCode = 1;
    } else record("Only the disposable registration account was removed");
  }
  if (before) {
    if (before === (await snapshot()))
      record("Existing accounts and authenticator factors are unchanged");
    else {
      checks.push({ name: "Existing account preservation", status: "FAIL" });
      process.exitCode = 1;
    }
  }
  mkdirSync("test-results/registration", { recursive: true });
  writeFileSync(
    `test-results/registration/${staging ? "staging" : "working"}.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        project,
        checks,
        boundary:
          "Real public signup and TOTP with a disposable account; no user wallet, token payment or email delivery tested",
      },
      null,
      2,
    ) + "\n",
  );
}
