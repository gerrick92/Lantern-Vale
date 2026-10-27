import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { vercel } from "../../scripts/retain-hosted-backup.mjs";

// Only this existing protected review, never an arbitrary host or production DB.
const review = JSON.parse(
  readFileSync("test-results/hosting/review-deployment.json", "utf8"),
);
assert.equal(review.status, "READY");
const deployment = await vercel(`/v13/deployments/${review.id}`);
assert.equal(deployment.projectId, "prj_e6pw3goMLbaj0PzAfYiTky6DgUib");
assert.equal(review.url, `https://${deployment.url}`);
assert.equal(deployment.autoAssignCustomDomains, false);
const project = await vercel(`/v9/projects/${deployment.projectId}`);
assert.ok(project.ssoProtection);
const bypass = Object.keys(project.protectionBypass || {})[0];
assert.ok(bypass, "Use the already-authorized CLI review access first.");
const env = parseEnv(readFileSync("apps/web/.env.staging.local", "utf8"));
assert.equal(
  env.NEXT_PUBLIC_SUPABASE_URL,
  "https://nisviqoxcfbtwccdjqoz.supabase.co",
);
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
])
  process.env[key] = env[key];
process.env.APP_ORIGIN = review.url;
process.env.TEST_ACCOUNT_DATA = "true";
process.env.TEST_MFA_BROWSER = "false";
process.env.TEST_AUTH_BROWSER = "false";
const originalFetch = globalThis.fetch;
const anonymous = await originalFetch(review.url, { redirect: "manual" });
assert.equal(anonymous.status, 302, "The deployment must remain protected.");
globalThis.fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== review.url) return originalFetch(input, init);
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
    "test-results/hosting/hosted-accounts.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        deploymentId: review.id,
        origin: review.url,
        database: "Lantern Vale Staging",
        status,
        scope:
          "Public registration, TOTP, private APIs, RLS, SIWE with an unfunded fixture wallet, developer denial and fixture cleanup. No live GLOW transaction.",
      },
      null,
      2,
    ) + "\n",
  );
}
