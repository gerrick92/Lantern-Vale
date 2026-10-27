import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authConfig, authConfigured } from "@/lib/auth-config";
import { ApiError } from "./http";

export async function sessionClient() {
  if (!authConfigured)
    throw new ApiError(503, "Account services are not configured yet.");
  const jar = await cookies();
  return createServerClient(authConfig.url!, authConfig.key!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (updates) => {
        try {
          updates.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server components rely on proxy.ts to refresh cookies. */
        }
      },
    },
  });
}
export function adminDb() {
  const secretKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authConfig.url || !secretKey)
    throw new ApiError(503, "Private account storage is not configured yet.");
  return createClient(authConfig.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function requireUser(mfa = true) {
  const db = await sessionClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new ApiError(401, "Sign in to continue.");
  // Supabase auto-confirms demo registration; this is account activation,
  // not evidence that the player owns the supplied email address.
  if (!user.email_confirmed_at)
    throw new ApiError(
      403,
      "Your account is not active. Please sign in again.",
    );
  const claims = await db.auth.getClaims();
  if (claims.error || claims.data?.claims.sub !== user.id)
    throw new ApiError(401, "Your session could not be verified.");
  if (
    mfa &&
    (claims.data.claims.aal !== "aal2" ||
      !user.factors?.some(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "verified",
      ))
  )
    throw new ApiError(403, "Complete two-factor authentication to continue.");
  return { db, user };
}
export async function linkedWallet(userId: string) {
  const { data, error } = await adminDb()
    .from("wallet_links")
    .select("address")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(503, "Wallet ownership could not be checked.");
  if (!data)
    throw new ApiError(403, "Verify wallet ownership in Settings first.");
  return data.address as `0x${string}`;
}
export async function rateLimit(
  userId: string,
  scope: string,
  maximum: number,
) {
  const { data, error } = await adminDb().rpc("take_rate_limit", {
    p_user: userId,
    p_scope: scope,
    p_max: maximum,
  });
  if (error) throw new ApiError(503, "Request protection is unavailable.");
  if (!data)
    throw new ApiError(429, "Too many requests. Please wait a minute.");
}
