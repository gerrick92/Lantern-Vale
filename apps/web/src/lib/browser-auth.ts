import { createBrowserClient } from "@supabase/ssr";
import { authConfig, authConfigured } from "./auth-config";
export function browserAuth() {
  if (!authConfigured)
    throw new Error("Account services are not configured yet.");
  return createBrowserClient(authConfig.url!, authConfig.key!);
}
