import { z } from "zod";
import { requireUser, rateLimit } from "@/server/auth";
import { endpoint, json, checkOrigin, readBody, ApiError } from "@/server/http";
import { checkedAddress } from "@/lib/chain";
export async function GET() {
  return endpoint(async () => {
    const { db } = await requireUser();
    const { data, error } = await db
      .from("contacts")
      .select("id,label,address,is_favorite")
      .order("is_favorite", { ascending: false })
      .order("label");
    if (error) throw new ApiError(503, "Contacts could not be loaded.");
    return json({ contacts: data });
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    await rateLimit(user.id, "contact-write", 30);
    const body = await readBody(
      request,
      z
        .object({
          id: z.uuid().optional(),
          label: z.string().trim().min(1).max(60),
          address: z.string(),
          is_favorite: z.boolean(),
        })
        .strict(),
    );
    let address;
    try {
      address = checkedAddress(body.address);
    } catch {
      throw new ApiError(400, "Invalid recipient address or checksum.");
    }
    const { error } = await db
      .from("contacts")
      .upsert({ ...body, address, user_id: user.id });
    if (error) throw new ApiError(409, "Contact could not be saved.");
    return json({ saved: true });
  });
}
export async function DELETE(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    await rateLimit(user.id, "contact-write", 30);
    const body = await readBody(request, z.object({ id: z.uuid() }).strict());
    const { error } = await db
      .from("contacts")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (error) throw new ApiError(503, "Contact could not be deleted.");
    return json({ deleted: true });
  });
}
