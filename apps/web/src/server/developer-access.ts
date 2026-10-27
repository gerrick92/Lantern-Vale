import "server-only";
import { notFound } from "next/navigation";
import { requireUser } from "./auth";
import { ApiError } from "./http";
import { isDeveloperAccount } from "./developer-policy";

export async function canAccessDeveloperTools() {
  if (!isDeveloperAccount(process.env.DEVELOPER_USER_ID ?? "")) return false;
  try {
    // requireUser validates the provider's user, email, session and current TOTP.
    const { user } = await requireUser();
    return isDeveloperAccount(user.id);
  } catch (error) {
    if (error instanceof ApiError) return false;
    throw error;
  }
}

export async function requireDeveloperPage() {
  if (!(await canAccessDeveloperTools())) notFound();
}
