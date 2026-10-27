import { canUseGlow } from "@/server/economy-access";
import { requireUser, linkedWallet, rateLimit } from "@/server/auth";
import { ownedRound } from "@/server/rounds";
import { issueSettlement } from "@/server/issue-settlement";
import { endpoint, checkOrigin, json, ApiError } from "@/server/http";
import { economyReleaseMessage } from "@/lib/economy-release";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    if (!canUseGlow()) throw new ApiError(503, economyReleaseMessage);
    await rateLimit(user.id, "settlement", 6);
    const { id } = await params;
    const round = await ownedRound(id, user.id);
    if ((await linkedWallet(user.id)).toLowerCase() !== round.wallet_address)
      throw new ApiError(
        403,
        "Use the verified wallet that paid for this adventure.",
      );
    return json(await issueSettlement(round));
  });
}
