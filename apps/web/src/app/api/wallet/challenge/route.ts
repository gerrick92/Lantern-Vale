import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createSiweMessage } from "viem/siwe";
import { checkedAddress, CHAIN_ID } from "@/lib/chain";
import { adminDb, requireUser, rateLimit } from "@/server/auth";
import {
  endpoint,
  json,
  checkOrigin,
  readBody,
  appOrigin,
  ApiError,
} from "@/server/http";
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(user.id, "siwe", 6);
    const body = await readBody(
      request,
      z.object({ address: z.string().length(42) }).strict(),
    );
    let address;
    try {
      address = checkedAddress(body.address);
    } catch {
      throw new ApiError(400, "Invalid wallet address.");
    }
    const nonce = randomBytes(16).toString("hex");
    const expires = new Date(Date.now() + 300_000);
    const origin = appOrigin();
    const message = createSiweMessage({
      address,
      chainId: CHAIN_ID,
      domain: new URL(origin).host,
      uri: origin,
      version: "1",
      nonce,
      issuedAt: new Date(),
      expirationTime: expires,
      statement:
        "Link this wallet to your signed-in Lantern Vale account. This does not authorize a token transfer.",
    });
    const { data, error } = await adminDb()
      .from("wallet_challenges")
      .insert({
        user_id: user.id,
        address,
        nonce,
        message,
        expires_at: expires.toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new ApiError(503, "Wallet challenge could not be saved.");
    return json({ id: data.id, message });
  });
}
