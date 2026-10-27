import { loadEnvFile } from "node:process";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
loadEnvFile("apps/web/.env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const origin = process.env.APP_ORIGIN;
if (!url || !key || !secret || !origin)
  throw new Error("Configure Supabase and APP_ORIGIN first.");
const admin = createClient(url, secret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const created = [];
let mfaBrowserTested = false;
function checked(result) {
  if (result.error)
    throw new Error(
      `${result.error.code || "SERVICE_ERROR"}: ${result.error.message}`,
    );
  return result.data;
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replaceAll("=", ""))
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[19] & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}
async function testEnrollmentRetry(client, cookies) {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL(
    "../../.tools/browsers",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const { chromium } = await import("@playwright/test");
  const other = checked(
    await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Another temporary QA authenticator",
    }),
  );
  const browser = await chromium.launch({
    headless: true,
    args: ["--mute-audio"],
  });
  try {
    const context = await browser.newContext();
    await context.addCookies(
      [...cookies].map(([name, value]) => ({
        name,
        value,
        url: origin,
        sameSite: "Lax",
      })),
    );
    const page = await context.newPage();
    await page.goto(`${origin}/auth`);
    const setup = page.getByRole("button", {
      name: "Set up authenticator",
    });
    const qr = page.getByRole("img", {
      name: "Scan this private authenticator enrollment QR code",
    });
    await setup.click();
    try {
      await qr.waitFor({ state: "visible" });
    } catch {
      const status = await page
        .locator("section")
        .filter({
          has: page.getByRole("heading", {
            name: "Authenticator",
            exact: true,
          }),
        })
        .getByRole("status")
        .innerText();
      throw new Error(
        `Authenticator enrollment UI failed: ${status || "No status was rendered"}`,
      );
    }
    assert.equal(await qr.evaluate((el) => el.tagName.toLowerCase()), "svg");
    const first = checked(await client.auth.mfa.listFactors()).all.find(
      (f) => f.friendly_name === "Lantern Vale authenticator",
    );
    assert.ok(first && first.status === "unverified");
    assert.equal(
      await setup.count(),
      0,
      "Setup cannot be duplicated while enrollment is shown.",
    );
    let factors = checked(await client.auth.mfa.listFactors()).all;
    assert.equal(
      factors.filter((f) => f.friendly_name === "Lantern Vale authenticator")
        .length,
      1,
    );
    assert.ok(factors.some((f) => f.id === first.id));
    await page.reload();
    await setup.click();
    await qr.waitFor({ state: "visible" });
    factors = checked(await client.auth.mfa.listFactors()).all;
    assert.equal(
      factors.filter((f) => f.friendly_name === "Lantern Vale authenticator")
        .length,
      1,
    );
    assert.ok(!factors.some((f) => f.id === first.id));
    assert.ok(
      factors.some((f) => f.id === other.id),
      "Unrelated enrollment must be preserved.",
    );
    console.log(
      "PASS: authenticator QR renders; duplicate setup is hidden; reload replaces only this app's unfinished enrollment.",
    );
  } finally {
    await browser.close();
    for (const factor of checked(
      await client.auth.mfa.listFactors(),
    ).all.filter((f) => f.status === "unverified")) {
      checked(await client.auth.mfa.unenroll({ factorId: factor.id }));
    }
  }
}
async function fixture() {
  const email = `mosslight-qa-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString("base64url");
  const cookies = new Map();
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (updates) =>
        updates.forEach(({ name, value }) => cookies.set(name, value)),
    },
  });
  const signup = checked(await client.auth.signUp({ email, password }));
  const user = signup.user;
  assert.ok(user);
  created.push(user.id);
  assert.ok(
    signup.session,
    "Public registration must start a session without email delivery.",
  );
  assert.notEqual(user.id, process.env.DEVELOPER_USER_ID);
  const call = async (path, body, method = body ? "POST" : "GET") => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        cookie: [...cookies].map(([n, v]) => `${n}=${v}`).join("; "),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    return {
      status: response.status,
      headers: response.headers,
      data: await response.json(),
    };
  };
  assert.equal(
    (await call("/api/profile")).status,
    403,
    "aal1 must not access private profiles",
  );
  if (process.env.TEST_ACCOUNT_DATA === "true") {
    assert.equal((await call("/api/account/data")).status, 403);
    assert.equal((await call("/api/account/deletion")).status, 403);
  }
  if (process.env.TEST_MFA_BROWSER === "true" && !mfaBrowserTested) {
    await testEnrollmentRetry(client, cookies);
    mfaBrowserTested = true;
  }
  const factor = checked(
    await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Temporary QA authenticator",
    }),
  );
  assert.ok(factor.totp.qr_code.startsWith("data:image/svg+xml;"));
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
  assert.equal((await call("/api/profile")).status, 200);
  return { user, client, call, cookies, factorId: factor.id };
}
try {
  const a = await fixture(),
    b = await fixture();
  console.log(
    "PASS: two public registrations need no email link, enforce AAL1 denial and verify TOTP to AAL2.",
  );
  for (const account of [a, b]) {
    for (const path of ["/dev/play", "/dev/deploy", "/dev/deploy/game"])
      assert.equal(
        (
          await fetch(`${origin}${path}`, {
            headers: {
              cookie: [...account.cookies]
                .map(([n, v]) => `${n}=${v}`)
                .join("; "),
            },
            redirect: "manual",
          })
        ).status,
        404,
      );
  }
  console.log("PASS: both new players are denied every developer route.");
  assert.equal(
    (await a.call("/api/profile", { display_name: "Temporary QA profile" }))
      .status,
    200,
  );
  assert.equal((await b.call("/api/profile")).data.profile, null);
  const wallet = privateKeyToAccount(generatePrivateKey());
  assert.equal(
    (
      await a.call("/api/contacts", {
        label: "Temporary QA contact",
        address: wallet.address,
        is_favorite: true,
      })
    ).status,
    200,
  );
  const own = await a.call("/api/contacts");
  assert.equal(own.data.contacts.length, 1);
  assert.equal((await b.call("/api/contacts")).data.contacts.length, 0);
  assert.deepEqual(
    checked(
      await b.client
        .from("contacts")
        .select("id")
        .eq("id", own.data.contacts[0].id),
    ),
    [],
  );
  const forbidden = await b.client
    .from("contacts")
    .update({ label: "Attempted cross-account write" })
    .eq("id", own.data.contacts[0].id)
    .select("id");
  assert.deepEqual(checked(forbidden), []);
  console.log(
    "PASS: real API and RLS isolate profiles and contacts between users.",
  );
  if (process.env.TEST_ACCOUNT_DATA === "true") {
    const exported = await a.call("/api/account/data");
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("cache-control"), "private, no-store");
    assert.equal(exported.headers.get("x-content-type-options"), "nosniff");
    assert.match(exported.headers.get("content-disposition"), /attachment;/);
    assert.equal(exported.data.account.id, a.user.id);
    assert.equal(exported.data.data.contacts.length, 1);
    const other = await b.call("/api/account/data");
    assert.equal(other.status, 200);
    assert.equal(other.data.account.id, b.user.id);
    assert.deepEqual(other.data.data.contacts, []);
    assert.equal((await fetch(`${origin}/api/account/data`)).status, 401);
    assert.equal(
      (
        await a.call("/api/account/deletion", {
          action: "request",
          confirmation: "DELETE",
          userId: b.user.id,
        })
      ).status,
      400,
    );
    const requested = await a.call("/api/account/deletion", {
      action: "request",
      confirmation: "DELETE",
    });
    assert.equal(requested.status, 200);
    assert.ok(requested.data.requestedAt);
    assert.equal(requested.data.needsPaymentReview, false);
    assert.deepEqual(
      (
        await a.call("/api/account/deletion", {
          action: "request",
          confirmation: "DELETE",
        })
      ).data,
      requested.data,
    );
    assert.equal(
      (await b.call("/api/account/deletion")).data.requestedAt,
      null,
    );
    assert.ok(
      (await b.client.rpc("export_account_data", { p_user: a.user.id })).error,
      "A browser role must not invoke privileged account export.",
    );
    assert.equal(
      (await a.call("/api/account/deletion", { action: "cancel" })).data
        .requestedAt,
      null,
    );
    assert.equal((await a.call("/api/profile")).status, 200);
    assert.equal((await a.call("/api/contacts")).data.contacts.length, 1);
    console.log(
      "PASS: hosted private exports and deletion requests isolate accounts, preserve data, deny AAL1/anonymous access and support cancellation.",
    );
  }
  const challenge = await a.call("/api/wallet/challenge", {
    address: wallet.address,
  });
  assert.equal(challenge.status, 200);
  const signature = await wallet.signMessage({
    message: challenge.data.message,
  });
  assert.equal(
    (await b.call("/api/wallet/verify", { id: challenge.data.id, signature }))
      .status,
    400,
  );
  assert.equal(
    (await a.call("/api/wallet/verify", { id: challenge.data.id, signature }))
      .status,
    200,
  );
  assert.equal(
    (await a.call("/api/wallet/verify", { id: challenge.data.id, signature }))
      .status,
    400,
  );
  const takeover = await b.call("/api/wallet/challenge", {
    address: wallet.address,
  });
  const takeoverSignature = await wallet.signMessage({
    message: takeover.data.message,
  });
  assert.equal(
    (
      await b.call("/api/wallet/verify", {
        id: takeover.data.id,
        signature: takeoverSignature,
      })
    ).status,
    409,
  );
  console.log(
    "PASS: SIWE verifies an unfunded test wallet and rejects nonce replay and account takeover.",
  );
  const expired = await a.call("/api/wallet/challenge", {
    address: wallet.address,
  });
  checked(
    await admin
      .from("wallet_challenges")
      .update({ expires_at: new Date(0).toISOString() })
      .eq("id", expired.data.id),
  );
  assert.equal(
    (
      await a.call("/api/wallet/verify", {
        id: expired.data.id,
        signature: await wallet.signMessage({ message: expired.data.message }),
      })
    ).status,
    400,
  );
  console.log("PASS: expired SIWE challenge rejected.");
  if (process.env.TEST_PRIVATE_BROWSER === "true") {
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL(
      "../.tools/browsers",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const { chromium, firefox } = await import("@playwright/test");
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    for (const engine of [chromium, firefox]) {
      const browser = await engine.launch({
        headless: true,
        ...(engine.name() === "chromium"
          ? { args: ["--mute-audio"] }
          : { firefoxUserPrefs: { "media.volume_scale": "0.0" } }),
      });
      try {
        const context = await browser.newContext();
        await context.addCookies(
          [...a.cookies].map(([name, value]) => ({
            name,
            value,
            url: origin,
            sameSite: "Lax",
          })),
        );
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const path of [
          "/dashboard",
          "/wallet",
          "/adventure",
          "/settings",
        ]) {
          await page.goto(`${origin}${path}`);
          await page.waitForLoadState("networkidle");
          assert.ok(
            new URL(page.url()).pathname === path,
            `Private page redirected: ${path}`,
          );
          for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 844 });
            const audit = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze();
            assert.deepEqual(
              audit.violations.map((v) => ({
                id: v.id,
                targets: v.nodes.map((n) => n.target),
              })),
              [],
              `${path} accessibility at ${width}px`,
            );
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
              `${path} overflows at ${width}px`,
            );
          }
        }
        assert.deepEqual(errors, []);
        console.log(
          `PASS: ${engine.name()} authenticated private pages, desktop/mobile axe and no horizontal overflow.`,
        );
      } finally {
        await browser.close();
      }
    }
  }
  checked(await a.client.auth.mfa.unenroll({ factorId: a.factorId }));
  assert.equal(
    (await a.call("/api/profile")).status,
    403,
    "Removed authenticator must revoke private API access immediately.",
  );
  if (process.env.TEST_ACCOUNT_DATA === "true") {
    assert.equal((await a.call("/api/account/data")).status, 403);
    assert.equal((await a.call("/api/account/deletion")).status, 403);
  }
  console.log(
    "PASS: removed authenticator immediately blocks private API access.",
  );
  console.log(
    "NOT TESTED: real inbox delivery, user-owned MetaMask signing, paid rounds and token payouts.",
  );
} finally {
  for (const id of created) checked(await admin.auth.admin.deleteUser(id));
  console.log(
    `Cleaned up ${created.length} temporary fixture accounts and their private data.`,
  );
}
