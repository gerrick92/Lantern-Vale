import { z } from "zod";
import { requireUser, rateLimit } from "@/server/auth";
import {
  accountDataStatus,
  requestAccountDeletion,
} from "@/server/account-data";
import { endpoint, json, checkOrigin, readBody } from "@/server/http";

export async function GET() {
  return endpoint(async () => {
    const { user } = await requireUser();
    await rateLimit(user.id, "account-data-status", 30);
    return json(await accountDataStatus(user.id));
  });
}

export async function POST(request: Request) {
  return endpoint(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    const body = await readBody(
      request,
      z.discriminatedUnion("action", [
        z
          .object({
            action: z.literal("request"),
            confirmation: z.literal("DELETE"),
          })
          .strict(),
        z.object({ action: z.literal("cancel") }).strict(),
      ]),
    );
    await rateLimit(user.id, "account-deletion-request", 5);
    return json(
      await requestAccountDeletion(user.id, body.action === "request"),
    );
  });
}
