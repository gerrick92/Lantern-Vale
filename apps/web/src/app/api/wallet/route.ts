import { adminDb, requireUser } from "@/server/auth";
import { endpoint, json, checkOrigin, ApiError } from "@/server/http";
export async function GET() {
  return endpoint(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db
      .from("wallet_links")
      .select("address,verified_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new ApiError(503, "Wallet binding is unavailable.");
    return json({ wallet: data });
  });
}
export async function DELETE(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    const { error } = await adminDb()
      .from("wallet_links")
      .delete()
      .eq("user_id", user.id);
    if (error) throw new ApiError(503, "Wallet could not be unlinked.");
    return json({ unlinked: true });
  });
}
