import { test as base, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { loadEnvFile } from "node:process";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
type Cookies = Parameters<BrowserContext["addCookies"]>[0];

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replaceAll("=", "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

export const test = base.extend<object, { accountCookies: Cookies }>({
  accountCookies: [
    async ({ browserName }, provide) => {
      loadEnvFile("apps/web/.env.local");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const adminKey =
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY!;
      if (!url || !key || !adminKey)
        throw new Error(
          "Hosted account testing needs configured Supabase test credentials.",
        );
      const admin = createClient(url, adminKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const email =
        "game-qa-" + browserName + "-" + randomUUID() + "@example.invalid";
      const password = randomBytes(32).toString("base64url");
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error)
        throw new Error("Could not create the temporary game test account.");
      const userId = created.data.user.id;
      try {
        const jar = new Map<string, string>();
        const auth = createServerClient(url, key, {
          cookies: {
            getAll: () => [...jar].map(([name, value]) => ({ name, value })),
            setAll: (updates) => {
              for (const { name, value } of updates) jar.set(name, value);
            },
          },
        });
        if ((await auth.auth.signInWithPassword({ email, password })).error)
          throw new Error("Test account sign-in failed.");
        const enrolled = await auth.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Automated game fixture",
        });
        if (enrolled.error)
          throw new Error("Test authenticator enrollment failed.");
        if (
          (
            await auth.auth.mfa.challengeAndVerify({
              factorId: enrolled.data.id,
              code: totp(enrolled.data.totp.secret),
            })
          ).error
        )
          throw new Error("Test authenticator verification failed.");
        const origin = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
        await provide(
          [...jar]
            .filter(([, value]) => !!value)
            .map(([name, value]) => ({
              name,
              value,
              url: origin,
              httpOnly: false,
              sameSite: "Lax" as const,
            })),
        );
      } finally {
        if ((await admin.auth.admin.deleteUser(userId)).error)
          throw new Error("Temporary game test account cleanup failed.");
      }
    },
    { scope: "worker" },
  ],
  context: async ({ context, accountCookies }, provide) => {
    await context.addCookies(accountCookies);
    await provide(context);
  },
});

export { expect };
