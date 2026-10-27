import { requireUser } from "@/server/auth";
import { ownedRound } from "@/server/rounds";
import { endpoint, json } from "@/server/http";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { user } = await requireUser();
    const { id } = await params;
    const round = await ownedRound(id, user.id);
    return json({
      id: round.id,
      wallet: round.wallet_address,
      state: round.state,
      version: round.version,
      contract: round.gateway_address,
      contractRoundId: round.contract_round_id,
    });
  });
}
