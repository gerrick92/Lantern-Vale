import "server-only";
import { paidEconomyReady } from "@/lib/economy-release";

// Game availability never depends on developer status or a player allowlist.
// Callers still enforce current TOTP, wallet ownership and verified payments.
export function canUseGlow() {
  return paidEconomyReady;
}
