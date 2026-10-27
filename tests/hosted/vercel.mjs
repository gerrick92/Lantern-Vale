import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { vercel } from "../../scripts/retain-hosted-backup.mjs";

// Only the recorded protected deployment and its explicitly selected service.
const review = JSON.parse(
  readFileSync("test-results/hosting/review-deployment.json", "utf8"),
);
const publicCheck = process.argv.includes("--public");
assert.equal(review.status, "READY");
const deployment = await vercel(`/v13/deployments/${review.id}`);
assert.equal(deployment.projectId, "prj_e6pw3goMLbaj0PzAfYiTky6DgUib");
assert.equal(review.url, `https://${deployment.url}`);
const origin = review.applicationOrigin || review.url;
assert.ok(
  origin === review.url || origin === "https://lantern-vale.vercel.app",
);
assert.equal(deployment.autoAssignCustomDomains, false);
const project = await vercel(`/v9/projects/${deployment.projectId}`);
assert.ok(project.ssoProtection);
if (publicCheck) assert.equal(origin, "https://lantern-vale.vercel.app");
const bypass = publicCheck
  ? undefined
  : Object.keys(project.protectionBypass || {})[0];
if (!publicCheck)
  assert.ok(bypass, "Use the already-authorized CLI review access first.");
const glow = review.glowForAllRegisteredPlayers === true;
const env = parseEnv(
  readFileSync(
    glow ? "apps/web/.env.local" : "apps/web/.env.staging.local",
    "utf8",
  ),
);
assert.equal(
  env.NEXT_PUBLIC_SUPABASE_URL,
  glow
    ? "https://frbbhbkwtgqczdjfhedi.supabase.co"
    : "https://nisviqoxcfbtwccdjqoz.supabase.co",
);
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
])
  process.env[key] = env[key];
process.env.APP_ORIGIN = origin;
process.env.TEST_ACCOUNT_DATA = "true";
process.env.TEST_MFA_BROWSER = "false";
process.env.TEST_AUTH_BROWSER = "false";
process.env.TEST_GLOW_ACCESS = String(glow);
process.env.TEST_GLOW_REVIEW = String(glow);
const originalFetch = globalThis.fetch;
const anonymous = await originalFetch(origin, { redirect: "manual" });
assert.equal(anonymous.status, publicCheck ? 200 : 302);
globalThis.fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (publicCheck || url.origin !== origin) return originalFetch(input, init);
  const headers = new Headers(
    init.headers || (input instanceof Request ? input.headers : undefined),
  );
  headers.set("x-vercel-protection-bypass", bypass);
  return originalFetch(input, { ...init, headers });
};
let status = "FAIL";
try {
  // Existing real-service suite creates only disposable public registrations,
  // checks TOTP/RLS/SIWE and deletes only its own fixture accounts in finally.
  await import("./auth.mjs");
  status = "PASS";
} finally {
  globalThis.fetch = originalFetch;
  writeFileSync(
    `test-results/hosting/${publicCheck ? "public-" : ""}hosted-accounts.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        deploymentId: review.id,
        origin,
        database: glow ? "Lantern Vale Sepolia" : "Lantern Vale Staging",
        status,
        protectionBypassUsed: !publicCheck,
        scope:
          "Public registration, TOTP, private APIs, RLS, SIWE with an unfunded fixture wallet, developer denial and fixture cleanup. No live GLOW transaction.",
      },
      null,
      2,
    ) + "\n",
  );
}
