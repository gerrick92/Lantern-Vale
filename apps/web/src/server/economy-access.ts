import "server-only";
import { paidEconomyReady } from "@/lib/economy-release";
import { isDeveloperAccount } from "./developer-policy";

// Controlled Sepolia acceptance never grants access to other accounts or a
// production build. Every mutation still requires current email/TOTP identity.
export function canUseGlow(userId: string) {
  return (
    paidEconomyReady ||
    (isDeveloperAccount(userId) &&
      process.env.GLOW_ACCEPTANCE_ENABLED === "true")
  );
}
