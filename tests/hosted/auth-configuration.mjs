import { loadEnvFile } from "node:process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Staging-only service verification. Never load the existing account service,
// send an email, print an authentication link or retain fixture credentials.
loadEnvFile("apps/web/.env.staging.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const origin = process.env.APP_ORIGIN;
if (
  url !== "https://nisviqoxcfbtwccdjqoz.supabase.co" ||
  origin !== "http://127.0.0.1:3002" ||
  !process.env.SUPABASE_SECRET_KEY ||
  !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)
  throw new Error("Expected the reviewed isolated staging configuration.");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, options);
const client = createClient(
  url,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const checks = [];
let fixtureId;
const record = (name, pass) => {
  checks.push({ name, status: pass ? "PASS" : "FAIL" });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
};
const requireResult = (result) => {
  if (result.error) throw new Error("Staging service request did not succeed.");
  return result.data;
};
try {
  const email = `lantern-config-${randomUUID()}@example.invalid`;
  const password = `Aa1!${randomBytes(32).toString("base64url")}`;
  const created = requireResult(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  fixtureId = created.user.id;
  requireResult(await client.auth.signInWithPassword({ email, password }));

  const callback = `${origin}/auth/callback`;
  for (const [name, redirectTo, expected] of [
    ["exact staging callback is accepted", callback, callback],
    [
      "unlisted redirect falls back to the staging site URL",
      "https://unlisted.example.invalid/auth/callback",
      origin,
    ],
  ]) {
    const link = requireResult(
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      }),
    );
    const actual = new URL(link.properties.action_link).searchParams.get(
      "redirect_to",
    );
    record(name, actual === expected);
  }

  const short = await client.auth.updateUser({
    password: `Aa1!${randomBytes(8).toString("hex").slice(0, 7)}`,
  });
  record(
    "provider rejects an eleven-character password",
    short.error?.code === "weak_password",
  );
  // If the policy was too weak, restore the synthetic account before cleanup.
  if (!short.error)
    requireResult(
      await admin.auth.admin.updateUserById(fixtureId, { password }),
    );
  const validPassword = `Aa1!${randomBytes(8).toString("hex").slice(0, 8)}`;
  const valid = await client.auth.updateUser({ password: validPassword });
  record("provider accepts a twelve-character password", !valid.error);
  if (!valid.error) {
    await client.auth.signOut();
    const login = await client.auth.signInWithPassword({
      email,
      password: validPassword,
    });
    record("updated fixture password can sign in", !login.error);
  }
} catch {
  checks.push({
    name: "staging configuration service check",
    status: "BLOCKED",
  });
  console.error(
    "BLOCKED: staging service check could not complete; no credential details logged.",
  );
} finally {
  if (fixtureId) {
    const removed = await admin.auth.admin.deleteUser(fixtureId);
    record("disposable configuration account removed", !removed.error);
    if (removed.error) console.error(`Fixture requiring cleanup: ${fixtureId}`);
  }
  mkdirSync("test-results/online/staging", { recursive: true });
  writeFileSync(
    "test-results/online/staging/auth-configuration.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        project: "nisviqoxcfbtwccdjqoz",
        checks,
        boundary:
          "Real staging Auth; disposable fixture only; no inbox delivery or user account tested",
        ...(checks.some(
          (check) =>
            check.name === "disposable configuration account removed" &&
            check.status !== "PASS",
        )
          ? { cleanupFixtureId: fixtureId }
          : {}),
      },
      null,
      2,
    ) + "\n",
  );
  if (checks.some((check) => check.status !== "PASS")) process.exitCode = 1;
}
