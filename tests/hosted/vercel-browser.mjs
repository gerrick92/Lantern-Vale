import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { vercel } from "../../scripts/retain-hosted-backup.mjs";

process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
const { chromium, expect } = await import("@playwright/test");
const { default: AxeBuilder } = await import("@axe-core/playwright");
const review = JSON.parse(
  readFileSync("test-results/hosting/review-deployment.json", "utf8"),
);
const origin = review.applicationOrigin || review.url;
const publicCheck = process.argv.includes("--public");
assert.ok(
  origin === review.url || origin === "https://lantern-vale.vercel.app",
);
const project = await vercel("/v9/projects/prj_e6pw3goMLbaj0PzAfYiTky6DgUib");
const bypass = publicCheck
  ? undefined
  : Object.keys(project.protectionBypass || {})[0];
if (!publicCheck) assert.ok(bypass);
if (publicCheck) assert.equal(origin, "https://lantern-vale.vercel.app");
assert.equal(
  (await fetch(origin, { redirect: "manual" })).status,
  publicCheck ? 200 : 302,
);
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
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const email = `lantern-cloud-${randomUUID()}@example.com`;
const password = `Aa1!${randomBytes(24).toString("base64url")}`;
let fixtureId;
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio"],
});
const checks = [];
let status = "FAIL";
const record = (name) => {
  checks.push({ name, status: "PASS" });
  console.log(`PASS: ${name}`);
};
function code(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replaceAll("=", "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const count = Buffer.alloc(8);
  count.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(count).digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  // Keep the access token away from Supabase, RPCs and all third-party requests.
  await context.route("**/*", (route) =>
    !publicCheck && new URL(route.request().url()).origin === origin
      ? route.continue({
          headers: {
            ...route.request().headers(),
            "x-vercel-protection-bypass": bypass,
          },
        })
      : route.continue(),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", () => errors.push("Browser runtime error"));
  await page.goto(`${origin}/auth?mode=register`);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/dashboard`, { timeout: 20000 });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  assert.ifError(users.error);
  fixtureId = users.data.users.find((u) => u.email === email)?.id;
  assert.ok(fixtureId);
  await expect(
    page.getByRole("heading", { name: "Secure your account" }),
  ).toBeVisible();
  record(
    "Cloud browser registration goes directly to mandatory authenticator setup",
  );
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: "Scan this private authenticator enrollment QR code",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByText("Cannot scan? Use a setup key", { exact: true }).click();
  const secret = await page
    .getByLabel("Private setup key", { exact: true })
    .inputValue();
  await page.getByLabel("Six-digit code", { exact: true }).fill(code(secret));
  await page
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Secure your account" }),
  ).toHaveCount(0, { timeout: 20000 });
  record(
    "The real cloud authenticator form accepts the fixture's current TOTP code",
  );
  for (const path of ["/dashboard", "/wallet", "/settings", "/adventure"]) {
    await page.goto(origin + path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (glow && path === "/adventure")
      await expect(
        page.getByRole("link", { name: "Start game", exact: true }),
      ).toHaveAttribute("href", "/adventure/play");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        result.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
        [],
        `${path} axe at ${width}`,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path} overflow`,
      );
    }
    record(
      `Cloud ${path} renders at desktop/phone widths with no targeted axe violations`,
    );
  }
  assert.deepEqual(errors, []);
  status = "PASS";
} catch {
  // Locator failures may include private enrollment values in their snapshots.
  console.error(
    `Cloud browser check failed after ${checks.length} completed checks. No authenticated snapshot was saved.`,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  if (!fixtureId) {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    fixtureId = users.data?.users.find((u) => u.email === email)?.id;
  }
  if (fixtureId) {
    const result = await admin.auth.admin.deleteUser(fixtureId);
    assert.ifError(result.error);
  }
  writeFileSync(
    `test-results/hosting/${publicCheck ? "public-" : ""}browser-accounts.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        origin,
        status,
        protectionBypassUsed: !publicCheck,
        checks,
        fixtureRemoved: Boolean(fixtureId),
        evidenceLimit:
          "Disposable account only; no user credentials, screenshots, recordings or real wallet transactions.",
      },
      null,
      2,
    ) + "\n",
  );
}
