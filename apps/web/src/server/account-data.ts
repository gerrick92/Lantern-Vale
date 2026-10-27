import "server-only";
import { adminDb } from "./auth";
import { ApiError } from "./http";
import type { AccountDataStatus } from "@/lib/account-data";

const unavailable =
  "Account data tools are awaiting a service update. Please try again later.";
export async function accountDataStatus(
  userId: string,
): Promise<AccountDataStatus> {
  const { data, error } = await adminDb().rpc("account_data_status", {
    p_user: userId,
  });
  if (error?.code === "PGRST202" || error?.code === "42883")
    return { available: false, requestedAt: null, needsPaymentReview: false };
  if (error || !data)
    throw new ApiError(503, "Account data status could not be loaded.");
  return {
    available: true,
    requestedAt: data.requestedAt,
    needsPaymentReview: data.needsPaymentReview,
  };
}

export async function requestAccountDeletion(
  userId: string,
  requested: boolean,
): Promise<AccountDataStatus> {
  const { data, error } = await adminDb().rpc("request_account_deletion", {
    p_user: userId,
    p_request: requested,
  });
  if (error || !data) throw new ApiError(503, unavailable);
  return {
    available: true,
    requestedAt: data.requestedAt,
    needsPaymentReview: data.needsPaymentReview,
  };
}

export async function exportAccountData(userId: string) {
  const { data, error } = await adminDb().rpc("export_account_data", {
    p_user: userId,
  });
  if (error?.code === "54000")
    throw new ApiError(
      413,
      "Your history is too large for an automatic download. Contact the project operator for a complete export.",
    );
  if (error || !data) throw new ApiError(503, unavailable);
  return data;
}
