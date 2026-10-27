import { canUseGlow } from "@/server/economy-access";
import { z } from "zod";
import { classSchema, intentSchema } from "@game/rules";
import { adminDb, requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { ownedRound } from "@/server/rounds";
import { reviewPayment } from "@/server/payment-review";
import { retainGameplay } from "@/server/game-recovery";
import { economyReleaseMessage } from "@/lib/economy-release";
import { endpoint, checkOrigin, readBody, json, ApiError } from "@/server/http";

export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    if (!canUseGlow(user.id)) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "payment-review", 20);
    await retainGameplay(user.id);
    const body = await readBody(
      request,
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("entry"), classId: classSchema }).strict(),
        z
          .object({
            kind: z.literal("purchase"),
            roundId: z.uuid(),
            version: z.number().int().nonnegative(),
            requestId: z.uuid(),
            intent: intentSchema,
          })
          .strict(),
      ]),
    );
    const wallet = await linkedWallet(user.id);
    const plan = await reviewPayment(
      wallet,
      body.kind === "entry"
        ? body
        : { ...body, round: await ownedRound(body.roundId, user.id) },
    );
    const { data, error } = await adminDb().rpc("reserve_payment_review", {
      p_user: user.id,
      p_plan: plan,
    });
    if (error)
      throw new ApiError(
        409,
        "A payment is already pending or the adventure changed. Recover the saved review first.",
      );
    await retainGameplay(user.id);
    return json(data);
  });
}
