import { z } from "zod";
import { verifyMessage } from "viem";
import { adminDb, requireUser, rateLimit } from "@/server/auth";
import { endpoint, json, checkOrigin, readBody, ApiError } from "@/server/http";
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(user.id, "siwe-verify", 10);
    const body = await readBody(
      request,
      z
        .object({
          id: z.uuid(),
          signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
        })
        .strict(),
    );
    const db = adminDb();
    const { data, error } = await db
      .from("wallet_challenges")
      .select("*")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .single();
    if (
      error ||
      !data ||
      data.used_at ||
      Date.parse(data.expires_at) <= Date.now()
    )
      throw new ApiError(
        400,
        "Challenge expired or already used. Request a new signature.",
      );
    if (
      !(await verifyMessage({
        address: data.address,
        message: data.message,
        signature: body.signature as `0x${string}`,
      }))
    )
      throw new ApiError(
        403,
        "The signature does not match this wallet challenge.",
      );
    const result = await db.rpc("consume_wallet_challenge", {
      p_id: body.id,
      p_user: user.id,
    });
    if (result.error)
      throw new ApiError(
        409,
        "The challenge was used or this wallet is linked to another account.",
      );
    return json({ verified: true, address: data.address });
  });
}
