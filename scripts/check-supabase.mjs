import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
loadEnvFile("apps/web/.env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !secret)
  throw new Error("Supabase connection values are incomplete.");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(url, secret, options);
const anon = createClient(url, key, options);
for (const table of [
  "profiles",
  "contacts",
  "wallet_links",
  "wallet_challenges",
  "game_rounds",
  "game_actions",
  "reward_claims",
  "rate_limits",
  "payment_receipts",
]) {
  const result = await admin
    .from(table)
    .select("*", { head: true, count: "exact" });
  if (result.error)
    throw new Error(`Server cannot access ${table}: ${result.error.code}`);
  console.log(`PASS: server connection to ${table}.`);
}
const blocked = await anon.from("contacts").select("id");
if (!blocked.error)
  throw new Error("FAIL: anonymous contact access was not denied.");
console.log("PASS: anonymous contact access denied.");
const settingsResponse = await fetch(`${url}/auth/v1/settings`, {
  headers: { apikey: key },
});
if (!settingsResponse.ok)
  throw new Error(`Auth settings returned ${settingsResponse.status}`);
const settings = await settingsResponse.json();
if (
  !settings.external?.email ||
  settings.mailer_autoconfirm !== true ||
  settings.disable_signup
)
  throw new Error(
    "Email/password registration must be open with confirmation emails disabled for this demo.",
  );
console.log(
  "PASS: public email/password registration is enabled without confirmation emails.",
);
if (
  ["google", "azure", "github"].some(
    (provider) => settings.external?.[provider] === true,
  )
)
  throw new Error("Unused social sign-in providers must remain disabled.");
console.log(
  "PASS: unused social sign-in providers are disabled. Hosted registration/TOTP and real wallet transactions require separate verification.",
);
