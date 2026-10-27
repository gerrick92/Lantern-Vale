import { canUseGlow } from "@/server/economy-access";
import { z } from "zod";
import { requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { findPayment } from "@/server/recover-payment";
import { economyReleaseMessage } from "@/lib/economy-release";
import { endpoint, checkOrigin, readBody, json, ApiError } from "@/server/http";

export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    if (!canUseGlow()) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "payment-recover", 30);
    const body = await readBody(
      request,
      z
        .object({
          paymentId: z.string().regex(/^0x[0-9a-f]{64}$/i),
          fromBlock: z
            .string()
            .regex(/^[0-9]{1,20}$/)
            .optional(),
        })
        .strict(),
    );
    const start = process.env.SEPOLIA_GAME_DEPLOYMENT_BLOCK;
    if (!start || !/^[1-9][0-9]{0,19}$/.test(start))
      throw new ApiError(
        503,
        "The verified game deployment block is not configured.",
      );
    const from = body.fromBlock ? BigInt(body.fromBlock) : BigInt(start);
    if (from < BigInt(start))
      throw new ApiError(
        400,
        "Recovery starts at the verified deployment block.",
      );
    return json(
      await findPayment(
        await linkedWallet(user.id),
        body.paymentId as `0x${string}`,
        from,
      ),
    );
  });
}
