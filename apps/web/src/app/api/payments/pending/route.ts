import { canUseGlow } from "@/server/economy-access";
import { adminDb, requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { economyReleaseMessage } from "@/lib/economy-release";
import { endpoint, json, ApiError } from "@/server/http";
import { retainGameplay } from "@/server/game-recovery";

export async function GET() {
  return endpoint(async () => {
    const { user } = await requireUser();
    if (!canUseGlow(user.id)) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "pending-payment", 30);
    await retainGameplay(user.id);
    const wallet = await linkedWallet(user.id);
    const { data, error } = await adminDb()
      .from("game_payment_reviews")
      .select("plan")
      .eq("user_id", user.id)
      .eq("status", "open")
      .maybeSingle();
    if (error) throw new ApiError(503, "Payment recovery is unavailable.");
    if (data && data.plan.wallet.toLowerCase() !== wallet.toLowerCase())
      throw new ApiError(
        409,
        "Reconnect the wallet associated with your pending payment.",
      );
    return json({ plan: data?.plan ?? null });
  });
}
