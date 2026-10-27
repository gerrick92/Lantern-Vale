import { z } from "zod";
import {
  encodeFunctionData,
  isAddressEqual,
  type Address,
  type Hash,
} from "viem";
import { classSchema, intentSchema, paymentItem } from "@game/rules";
import { settlementAbi, settlementClasses } from "@/lib/settlement";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entry"), classId: classSchema }).strict(),
  z
    .object({
      kind: z.literal("purchase"),
      roundId: z.uuid(),
      contractRoundId: z.string().regex(/^[1-9][0-9]{0,77}$/),
      version: z.number().int().nonnegative(),
      requestId: z.uuid(),
      intent: intentSchema,
    })
    .strict(),
]);
export const paymentPlanSchema = z
  .object({
    chainId: z.literal(11155111),
    wallet: address,
    contract: address,
    token: address,
    paymentId: hash.refine((value) => BigInt(value) !== 0n),
    action,
    deadline: z.string().regex(/^[1-9][0-9]{0,19}$/),
  })
  .strict()
  .refine(
    (plan) =>
      plan.action.kind === "entry" ||
      paymentItem(plan.action.intent) !== undefined,
    "This action is not a purchase.",
  );
export type PaymentPlan = z.infer<typeof paymentPlanSchema>;
const recordSchema = z
  .object({
    version: z.literal(1),
    plan: paymentPlanSchema,
    stage: z.enum([
      "prepared",
      "approving",
      "submitting",
      "submitted",
      "recorded",
      "expired",
    ]),
    hash: hash.optional(),
    approvalHash: hash.optional(),
    roundId: z.uuid().optional(),
  })
  .strict();
export type PaymentRecord = z.infer<typeof recordSchema>;
// A journal is only a resume hint. Execution still checks the live contract.
export function canResumePayment(
  record: PaymentRecord | undefined,
  plan: PaymentPlan,
) {
  return (
    !!record &&
    record.plan.paymentId === plan.paymentId &&
    !record.hash &&
    (record.stage === "prepared" ||
      (record.stage === "approving" && !!record.approvalHash))
  );
}
export type JournalStorage = Pick<Storage, "getItem" | "setItem">;
const journalKey = (wallet: string, contract: string) =>
  `lantern:payment:v1:11155111:${wallet.toLowerCase()}:${contract.toLowerCase()}`;

export function readPayment(
  storage: JournalStorage,
  wallet: Address,
  contract: Address,
): PaymentRecord | undefined {
  const raw = storage.getItem(journalKey(wallet, contract));
  if (!raw) return undefined;
  const record = recordSchema.parse(JSON.parse(raw));
  if (
    !isAddressEqual(record.plan.wallet as Address, wallet) ||
    !isAddressEqual(record.plan.contract as Address, contract)
  )
    throw new Error("The saved payment belongs to another wallet or contract.");
  return record;
}

export function savePayment(storage: JournalStorage, record: PaymentRecord) {
  record = recordSchema.parse(record);
  const key = journalKey(record.plan.wallet, record.plan.contract);
  const saved = readPayment(
    storage,
    record.plan.wallet as Address,
    record.plan.contract as Address,
  );
  if (
    saved &&
    !["recorded", "expired"].includes(saved.stage) &&
    saved.plan.paymentId !== record.plan.paymentId
  )
    throw new Error("Recover the previous payment before starting another.");
  if (
    saved?.plan.paymentId === record.plan.paymentId &&
    JSON.stringify(saved.plan) !== JSON.stringify(record.plan)
  )
    throw new Error("A saved payment review cannot be changed.");
  const raw = JSON.stringify(record);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw)
    throw new Error(
      "Payment recovery storage is unavailable. No new transaction will be requested.",
    );
}

export function paymentCall(plan: PaymentPlan) {
  paymentPlanSchema.parse(plan);
  return plan.action.kind === "entry"
    ? {
        address: plan.contract as Address,
        abi: settlementAbi,
        functionName: "enter" as const,
        args: [
          settlementClasses.indexOf(plan.action.classId),
          plan.paymentId as Hash,
          BigInt(plan.deadline),
        ] as const,
      }
    : {
        address: plan.contract as Address,
        abi: settlementAbi,
        functionName: "purchase" as const,
        args: [
          BigInt(plan.action.contractRoundId),
          paymentItem(plan.action.intent)!,
          plan.paymentId as Hash,
          BigInt(plan.deadline),
        ] as const,
      };
}

export function paymentCalldata(plan: PaymentPlan) {
  return encodeFunctionData(paymentCall(plan));
}
