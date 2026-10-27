import { canUseGlow } from "@/server/economy-access";
import { z } from "zod";
import { initialState, classSchema } from "@game/rules";
import { adminDb, requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { verifySettlementPayment } from "@/server/settlement-payments";
import { paymentRandomness } from "@/server/beacon-randomness";
import { paidEncounters } from "@/server/round-randomness";
import { endpoint, json, checkOrigin, readBody, ApiError } from "@/server/http";
import { economyReleaseMessage } from "@/lib/economy-release";
import { retainGameplay } from "@/server/game-recovery";
export async function GET() {
  return endpoint(async () => {
    const { db, user } = await requireUser();
    await retainGameplay(user.id);
    const { data, error } = await db
      .from("game_rounds")
      .select("id,class,state,version,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new ApiError(503, "Adventures could not be loaded.");
    return json({ rounds: data });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    if (!canUseGlow()) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "start-round", 8);
    await retainGameplay(user.id);
    const wallet = await linkedWallet(user.id);
    const body = await readBody(
      request,
      z
        .object({
          hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          classId: classSchema,
        })
        .strict(),
    );
    const payment = await verifySettlementPayment(
      body.hash.toLowerCase() as `0x${string}`,
      wallet,
    );
    if (payment.classId !== body.classId)
      throw new ApiError(
        409,
        "This entry was paid for a different class. Recover the original adventure.",
      );
    const db = adminDb();
    const existing = await db
      .from("game_rounds")
      .select("id,user_id,class")
      .eq("entry_tx_hash", body.hash.toLowerCase())
      .maybeSingle();
    if (existing.error)
      throw new ApiError(503, "Round storage is unavailable.");
    if (existing.data) {
      if (
        existing.data.user_id !== user.id ||
        existing.data.class !== body.classId
      )
        throw new ApiError(
          409,
          "This payment already belongs to an adventure.",
        );
      return json({ id: existing.data.id });
    }
    payment.randomnessProof = await paymentRandomness(payment);
    const { data, error } = await db.rpc("register_settlement_entry", {
      p_user: user.id,
      p_class: body.classId,
      p_state: initialState(body.classId, false, {
        verifiedEncounters: paidEncounters(payment, payment.randomnessProof),
      }),
      p_receipt: payment,
    });
    if (error)
      throw new ApiError(
        409,
        "This payment may already be registered. Refresh your adventures before paying again.",
      );
    await retainGameplay(user.id);
    return json({ id: data }, 201);
  });
}
