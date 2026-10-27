import { canUseGlow } from "@/server/economy-access";
import { z } from "zod";
import { adminDb, requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { verifyUnpaidExpiry } from "@/server/expire-payment";
import { retainGameplay } from "@/server/game-recovery";
import { paymentPlanSchema } from "@/features/game/payment-journal";
import { economyReleaseMessage } from "@/lib/economy-release";
import { endpoint, checkOrigin, readBody, json, ApiError } from "@/server/http";

export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    if (!canUseGlow(user.id)) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "expire-payment", 12);
    await retainGameplay(user.id);
    const body = await readBody(
      request,
      z.object({ paymentId: z.string().regex(/^0x[0-9a-f]{64}$/i) }).strict(),
    );
    const db = adminDb();
    const { data, error } = await db
      .from("game_payment_reviews")
      .select("plan,status")
      .eq("user_id", user.id)
      .eq("payment_id", body.paymentId.toLowerCase())
      .maybeSingle();
    if (error || !data) throw new ApiError(404, "Payment review not found.");
    if (data.status === "expired") return json({ expired: true });
    if (data.status !== "open")
      throw new ApiError(409, "This payment is already recorded.");
    await verifyUnpaidExpiry(
      paymentPlanSchema.parse(data.plan),
      await linkedWallet(user.id),
    );
    const update = await db
      .from("game_payment_reviews")
      .update({ status: "expired" })
      .eq("user_id", user.id)
      .eq("payment_id", body.paymentId.toLowerCase())
      .eq("status", "open")
      .select("payment_id");
    if (update.error || update.data?.length !== 1)
      throw new ApiError(
        409,
        "Payment changed during recovery. Refresh before continuing.",
      );
    await retainGameplay(user.id);
    return json({ expired: true });
  });
}
