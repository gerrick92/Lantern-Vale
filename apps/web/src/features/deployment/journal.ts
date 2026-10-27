import { z } from "zod";
import type { CompletedStep } from "./plan";
import { stepLabels } from "./plan";

const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value as `0x${string}`);
const journalSchema = z.object({
  fingerprint: z.string(),
  steps: z.array(z.object({ hash })).max(stepLabels.length),
  pendingHash: hash.optional(),
  inFlight: z.boolean().optional(),
});
export type DeploymentJournal = {
  fingerprint: string;
  steps: CompletedStep[];
  pendingHash?: `0x${string}`;
  inFlight?: boolean;
};
export function readJournal(
  raw: string | null,
  fingerprint: string,
): DeploymentJournal {
  if (!raw) return { fingerprint, steps: [] };
  const result = journalSchema.safeParse(JSON.parse(raw));
  if (!result.success || result.data.fingerprint !== fingerprint)
    throw new Error(
      "Saved deployment differs from this build. Reconcile its receipts before continuing.",
    );
  if (
    result.data.steps.length === stepLabels.length &&
    (result.data.pendingHash || result.data.inFlight)
  )
    throw new Error(
      "The completed deployment has an unexpected pending transaction.",
    );
  return result.data;
}
export function requireSettledJournal(journal: DeploymentJournal) {
  if (journal.pendingHash || journal.inFlight)
    throw new Error(
      "A transaction may already have been submitted. Resume its receipt or check MetaMask Activity before continuing.",
    );
}
export function wasUserRejected(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 10 && current && typeof current === "object";
    depth++
  ) {
    if ("code" in current && current.code === 4001) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
