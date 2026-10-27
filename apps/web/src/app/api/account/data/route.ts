import { requireUser, rateLimit } from "@/server/auth";
import { exportAccountData } from "@/server/account-data";
import { endpoint } from "@/server/http";
import { retainGameplay } from "@/server/game-recovery";

export async function GET() {
  return endpoint(async () => {
    const { user } = await requireUser();
    await rateLimit(user.id, "account-export", 2);
    const data = await exportAccountData(user.id);
    await retainGameplay(user.id);
    return Response.json(
      {
        format: "lantern-vale-account-v1",
        exportedAt: new Date().toISOString(),
        account: { id: user.id, email: user.email, createdAt: user.created_at },
        data,
        notes: [
          "This export contains private account data. Keep it somewhere safe.",
          "Passwords, authenticator secrets, sessions and signing material are excluded.",
          "Device preferences and local practice saves are stored only in your browser.",
          "Onchain records are public and cannot be erased by deleting an account.",
        ],
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition":
            'attachment; filename="lantern-vale-account.json"',
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  });
}
