import { loadEnvFile } from "node:process";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import jsQR from "jsqr";
loadEnvFile("apps/web/.env.local");
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".tools/browsers");
const { chromium } = await import("@playwright/test");
const { default: AxeBuilder } = await import("@axe-core/playwright");
const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3000";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const email = "enrollment-qa-" + randomUUID() + "@example.invalid";
let password = randomBytes(32).toString("base64url");
let userId, browser;
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replaceAll("=", "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
async function signIn(page) {
  await page.goto(origin + "/auth");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await page.waitForURL("**/dashboard");
}
try {
  browser = await chromium.launch({ args: ["--mute-audio"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin + "/");
  assert.equal(
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "Play", exact: true })
      .count(),
    0,
  );
  await page.goto(origin + "/auth?mode=register");
  const signupResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/auth/v1/signup",
  );
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const signup = await (await signupResponse).json();
  userId = signup.user?.id;
  assert.ok(
    userId && signup.access_token,
    "The real public registration form must create a session without email delivery.",
  );
  assert.notEqual(userId, process.env.DEVELOPER_USER_ID);
  await page.waitForURL("**/dashboard");
  console.log(
    "PASS: real browser registration creates a nondeveloper player without a confirmation email.",
  );
  await page.getByRole("heading", { name: "Secure your account" }).waitFor();
  assert.equal((await page.request.get(origin + "/api/profile")).status(), 403);
  const rawGame = await page.request.get(
    origin + "/games/mosslight/index.html?practice=1",
    { maxRedirects: 0 },
  );
  assert.equal(rawGame.status(), 307);
  assert.ok(rawGame.headers().location.endsWith("/adventure"));
  assert.equal(
    (await page.request.get(origin + "/games/mosslight/js/main.js")).status(),
    403,
  );
  await page.goto(origin + "/");
  await page
    .getByRole("link", { name: "Open dashboard", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Sign in", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("link", { name: "Your account", exact: true }).count(),
    0,
  );
  await page.goto(origin + "/auth");
  await page.waitForURL("**/settings");
  await page.getByRole("heading", { name: "Secure your account" }).waitFor();
  assert.equal((await page.request.get(origin + "/api/profile")).status(), 403);
  await page.goto(origin + "/");
  await page.getByRole("link", { name: "Play game", exact: true }).click();
  await page.getByRole("heading", { name: "Secure your account" }).waitFor();
  assert.equal((await page.goto(origin + "/dev/play")).status(), 404);
  assert.equal(
    await page.locator('iframe[src*="/games/mosslight/"]').count(),
    0,
  );
  await page.goto(origin + "/dashboard");
  await page
    .getByRole("button", { name: "Set up authenticator", exact: true })
    .click();
  const qr = page.getByRole("img", {
    name: "Scan this private authenticator enrollment QR code",
  });
  await qr.waitFor();
  // Decode the rendered pixels, rather than trusting the encoded source or an image-load check.
  const pixels = await qr.evaluate(async (svg) => {
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob),
      image = new Image();
    try {
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 232;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, 232, 232);
      return Array.from(context.getImageData(0, 0, 232, 232).data);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  const decoded = jsQR(Uint8ClampedArray.from(pixels), 232, 232);
  assert.ok(decoded, "Rendered QR must be scannable");
  const uri = new URL(decoded.data);
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.hostname, "totp");
  assert.equal(uri.searchParams.get("issuer"), "Lantern Vale");
  await page.getByText("Cannot scan? Use a setup key", { exact: true }).click();
  const keyInput = page.getByLabel("Private setup key", { exact: true });
  const secret = await keyInput.inputValue();
  assert.ok(
    secret === uri.searchParams.get("secret"),
    "Manual setup key must match the scannable QR",
  );
  await page.getByRole("button", { name: "Show key", exact: true }).click();
  assert.equal(await keyInput.getAttribute("type"), "text");
  await page.getByRole("button", { name: "Hide key", exact: true }).click();
  assert.equal(await keyInput.getAttribute("type"), "password");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Enrollment must fit mobile",
    );
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
    );
  }
  const wrong = String((Number(totp(secret)) + 1) % 1000000).padStart(6, "0");
  await page.getByLabel("Six-digit code", { exact: true }).fill(wrong);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.getByText(/That code was not accepted/).waitFor();
  assert.equal((await page.request.get(origin + "/api/profile")).status(), 403);
  await page.getByLabel("Six-digit code", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page
    .getByRole("heading", { name: "Your wallet", exact: true })
    .waitFor();
  assert.equal((await page.request.get(origin + "/api/profile")).status(), 200);
  assert.equal(
    await page
      .getByRole("img", {
        name: "Scan this private authenticator enrollment QR code",
      })
      .count(),
    0,
  );
  console.log(
    "PASS: real QR decoded from rendered pixels; manual key matches; invalid code rejected; valid code reaches AAL2 and private API.",
  );
  for (const path of ["/wallet", "/settings", "/adventure"]) {
    await page.goto(origin + path);
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(
      await page.getByRole("heading", { name: "Secure your account" }).count(),
      0,
    );
  }
  await page.goto(origin + "/auth");
  await page.waitForURL("**/settings");
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Email address", { exact: true }).count(),
    0,
  );
  assert.equal(
    (
      await page.request.get(origin + "/games/mosslight/index.html?practice=1")
    ).status(),
    200,
  );
  await page.goto(origin + "/");
  await page
    .getByRole("link", { name: "Open dashboard", exact: true })
    .waitFor();
  mkdirSync("test-results/account", { recursive: true });
  await page.screenshot({
    path: "test-results/account/signed-in-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Play game", exact: true }).click();
  await page
    .getByRole("link", { name: "Start game — Test", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Start game", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByText("How to play", { exact: true }).click();
  await page.getByText(/spending five tokens and losing costs five/).waitFor();
  await page
    .getByRole("navigation", { name: "Game pages" })
    .getByRole("link", { name: "History", exact: true })
    .click();
  await page.getByText("No GLOW adventures yet.", { exact: true }).waitFor();
  assert.equal(await page.getByText("How to play", { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Load saved adventures" }).count(),
    0,
  );
  await page
    .getByRole("navigation", { name: "Game pages" })
    .getByRole("link", { name: "Play", exact: true })
    .click();
  assert.equal(
    await page.locator("details.disclosure").getAttribute("open"),
    null,
  );
  for (const theme of ["light", "dark"]) {
    await page.goto(origin + "/settings");
    await page.getByLabel("Appearance", { exact: true }).selectOption(theme);
    for (const path of [
      "/adventure",
      "/adventure?view=history",
      "/settings",
      "/wallet",
    ]) {
      await page.goto(origin + path);
      if (path === "/adventure?view=history")
        await page
          .getByText("No GLOW adventures yet.", { exact: true })
          .waitFor();
      if (path === "/settings")
        await page
          .getByRole("heading", {
            name: "Authenticator connected",
            exact: true,
          })
          .waitFor();
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          path + " must fit at " + width,
        );
        if (width === 1440 && (path === "/wallet" || path === "/settings")) {
          const tops = await page
            .locator(".two-column")
            .evaluate((grid) =>
              [...grid.children].map(
                (column) => column.getBoundingClientRect().top,
              ),
            );
          assert.ok(Math.abs(tops[0] - tops[1]) < 1, "Column rules must align");
        }
        if (width !== 320) {
          const audit = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          assert.deepEqual(
            audit.violations.map((v) => ({
              id: v.id,
              targets: v.nodes.map((n) => n.target),
            })),
            [],
          );
          await page.screenshot({
            path:
              "test-results/account/" +
              path.slice(1).replace("?view=", "-") +
              "-" +
              theme +
              "-" +
              width +
              ".png",
            fullPage: true,
          });
        }
      }
    }
  }
  console.log(
    "PASS: separate game launch, instructions and history; disabled GLOW mode; aligned panels; verified routes fit desktop/mobile with no axe violations in either theme.",
  );
  await page.goto(origin + "/settings");
  await page
    .getByText("No wallet linked to your account yet.", { exact: true })
    .waitFor();
  await page.getByText(/MetaMask is not available in this browser/).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Connect Wallet", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Link wallet to account", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByText("Change password", { exact: true }).click();
  await page.getByRole("heading", { name: "Password", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Logout", exact: true }).waitFor();
  password = randomBytes(32).toString("base64url");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await page.getByText("Password updated.", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Authenticator connected" })
    .waitFor();
  await page
    .getByRole("region", { name: "Logout", exact: true })
    .getByText("Sign out", { exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out all sessions" }).click();
  await page.waitForURL("**/auth");
  await signIn(page);
  await page
    .getByText(
      "Enter the code from your existing Lantern Vale authenticator.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Set up authenticator", exact: true })
      .count(),
    0,
  );
  assert.equal((await page.request.get(origin + "/api/profile")).status(), 403);
  console.log(
    "PASS: private routes reachable after verification; next login requires existing authenticator; verified enrollment is preserved.",
  );
} finally {
  await browser?.close();
  if (userId) {
    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error)
      throw new Error("Temporary enrollment account cleanup failed");
    console.log(
      "PASS: temporary account removed. No enrollment screenshots, keys or codes saved.",
    );
  }
}
