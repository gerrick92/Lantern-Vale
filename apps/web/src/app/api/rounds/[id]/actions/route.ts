import { canUseGlow } from "@/server/economy-access";
import { z } from "zod";
import { intentSchema, reduceIntent, paymentItem } from "@game/rules";
import { economyReleaseMessage } from "@/lib/economy-release";
import { verifySettlementPayment } from "@/server/settlement-payments";
import { paymentRandomness, beaconChoice } from "@/server/beacon-randomness";
import { adminDb, requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { ownedRound } from "@/server/rounds";
import { retainGameplay } from "@/server/game-recovery";
import { endpoint, json, checkOrigin, readBody, ApiError } from "@/server/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    if (!canUseGlow()) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "game-action", 90);
    const { id } = await params;
    const round = await ownedRound(id, user.id);
    if (
      round.state.mode !== "paid" ||
      round.economy_version !== "settlement-v1"
    )
      throw new ApiError(
        409,
        "Only paid server-owned rounds use this endpoint.",
      );
    if ((await linkedWallet(user.id)).toLowerCase() !== round.wallet_address)
      throw new ApiError(
        403,
        "Reconnect and verify the wallet that paid for this adventure.",
      );
    const body = await readBody(
      request,
      z
        .object({
          version: z.number().int().nonnegative(),
          requestId: z.uuid(),
          intent: intentSchema,
          paymentHash: z
            .string()
            .regex(/^0x[0-9a-fA-F]{64}$/)
            .optional(),
        })
        .strict(),
    );
    const db = adminDb();
    const previous = await db
      .from("game_actions")
      .select("intent,result,version")
      .eq("id", body.requestId)
      .eq("round_id", id)
      .maybeSingle();
    if (previous.error)
      throw new ApiError(503, "Action history is unavailable.");
    const item = paymentItem(body.intent);
    if (previous.data && item === undefined) {
      if (
        JSON.stringify(previous.data.intent) !== JSON.stringify(body.intent) &&
        JSON.stringify(Object.entries(previous.data.intent).sort()) !==
          JSON.stringify(Object.entries(body.intent).sort())
      )
        throw new ApiError(409, "This request ID was already used.");
      await retainGameplay(user.id);
      return json({
        state: previous.data.result,
        version: previous.data.version,
      });
    }
    if (!previous.data && round.version !== body.version)
      throw new ApiError(
        409,
        "Adventure changed in another tab. Refresh before acting.",
      );
    if (item === undefined && body.paymentHash)
      throw new ApiError(400, "This action does not require a payment.");
    if (item !== undefined && !body.paymentHash)
      throw new ApiError(
        400,
        "Confirm this purchase in your wallet before continuing.",
      );
    const payment =
      item === undefined
        ? undefined
        : await verifySettlementPayment(
            body.paymentHash!.toLowerCase() as `0x${string}`,
            round.wallet_address,
            { roundId: BigInt(round.contract_round_id), item },
          );
    let verifiedChance: number | undefined;
    if (payment && (item === 6 || item === 7)) {
      payment.randomnessProof = await paymentRandomness(payment);
      verifiedChance = beaconChoice(
        payment.randomnessProof,
        payment,
        item === 6 ? "dancer" : "fairy",
        100,
      );
    }
    let state;
    try {
      state =
        previous.data?.result ??
        reduceIntent(
          round.state,
          body.intent,
          payment?.item ?? undefined,
          verifiedChance,
        );
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : "Invalid action.",
      );
    }
    const result = await db.rpc(
      payment ? "commit_settlement_purchase" : "commit_game_action",
      {
        p_round: id,
        p_user: user.id,
        p_version: body.version,
        p_request: body.requestId,
        p_intent: body.intent,
        p_state: state,
        ...(payment ? { p_receipt: payment } : {}),
      },
    );
    if (result.error)
      throw new ApiError(
        409,
        "Adventure changed while acting. Refresh to continue.",
      );
    await retainGameplay(user.id);
    return json(result.data);
  });
}
