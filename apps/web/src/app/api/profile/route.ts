import { z } from "zod";
import { requireUser, rateLimit } from "@/server/auth";
import { endpoint, json, checkOrigin, readBody, ApiError } from "@/server/http";
export async function GET() {
  return endpoint(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new ApiError(503, "Profile could not be loaded.");
    return json({
      userId: user.id,
      profile: data,
      email: user.email,
      verified: !!user.email_confirmed_at,
    });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    await rateLimit(user.id, "profile-write", 30);
    const body = await readBody(
      request,
      z.object({ display_name: z.string().trim().min(2).max(40) }).strict(),
    );
    const { error } = await db
      .from("profiles")
      .upsert({ user_id: user.id, ...body });
    if (error) throw new ApiError(503, "Profile could not be saved.");
    return json({ saved: true });
  });
}
