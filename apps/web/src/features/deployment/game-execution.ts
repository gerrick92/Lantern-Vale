import { z } from "zod";
import {
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import type { SavedGameReview } from "./game-plan";
import type {
  PreparedGameTransaction,
  GameReceiptHashes,
} from "./game-transaction";
import { gameFundingTransaction } from "./game-verification";
import { wasUserRejected } from "./journal";

const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as Hex);
const step = z.enum(["deploy", "fund"]);
const journalSchema = z
  .object({
    fingerprint: z.string(),
    deploymentHash: hash.optional(),
    fundingHash: hash.optional(),
    inFlight: step.optional(),
    pending: z.object({ step, hash }).strict().optional(),
  })
  .strict();
export type GameJournal = z.infer<typeof journalSchema>;

export function readGameJournal(
  raw: string | null,
  fingerprint: string,
): GameJournal {
  if (!raw) return { fingerprint };
  const result = journalSchema.safeParse(JSON.parse(raw));
  if (!result.success || result.data.fingerprint !== fingerprint)
    throw new Error(
      "Saved game deployment differs from this plan. Reconcile its receipts before continuing.",
    );
  const journal = result.data;
  const next = journal.deploymentHash ? "fund" : "deploy";
  if (
    (journal.fundingHash && !journal.deploymentHash) ||
    (journal.fundingHash && (journal.inFlight || journal.pending)) ||
    (journal.pending && journal.inFlight) ||
    (journal.pending && journal.pending.step !== next) ||
    (journal.inFlight && journal.inFlight !== next)
  )
    throw new Error(
      "The saved game deployment has inconsistent transaction state.",
    );
  return journal;
}

export function adoptGameReceipts(
  journal: GameJournal,
  hashes: GameReceiptHashes,
): GameJournal {
  if (
    !hashes.deploymentHash ||
    (journal.deploymentHash &&
      journal.deploymentHash !== hashes.deploymentHash) ||
    (journal.fundingHash && journal.fundingHash !== hashes.fundingHash) ||
    ((journal.inFlight === "fund" || journal.pending?.step === "fund") &&
      !hashes.fundingHash)
  )
    throw new Error(
      "These receipts do not reconcile the saved deployment. Keep the existing journal.",
    );
  return { fingerprint: journal.fingerprint, ...hashes };
}

type Wallet = {
  getChainId(): Promise<number>;
  getAddresses(): Promise<readonly Address[]>;
  sendTransaction(input: {
    account: Address;
    chain: typeof sepolia;
    to?: Address;
    data: Hex;
    value: bigint;
    gas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }): Promise<Hex>;
};
export type GameExecutionContext = {
  plan: SavedGameReview;
  wallet: Wallet;
  rpc: Pick<
    PublicClient,
    | "getChainId"
    | "getBalance"
    | "estimateGas"
    | "estimateFeesPerGas"
    | "waitForTransactionReceipt"
  >;
  read(): GameJournal;
  save(journal: GameJournal): void;
  prepare(hashes: GameReceiptHashes): Promise<PreparedGameTransaction>;
  report(message: string): void;
};
export type GameEstimate = {
  step: "deploy" | "fund";
  gas: bigint;
  maximumFee: bigint;
  at: number;
};

export async function executeGameTransaction(
  context: GameExecutionContext,
  action: "resume" | "estimate" | "submit",
  reviewed?: GameEstimate,
) {
  const { plan, rpc, wallet, save, prepare, report } = context;
  const requireWallet = async () => {
    const accounts = await wallet.getAddresses();
    if (
      (await wallet.getChainId()) !== sepolia.id ||
      (await rpc.getChainId()) !== sepolia.id ||
      !accounts[0] ||
      !isAddressEqual(accounts[0], plan.owner)
    )
      throw new Error("Connect the reviewed owner wallet on Ethereum Sepolia.");
  };
  await requireWallet();
  let journal = context.read();
  if (journal.inFlight)
    throw new Error(
      "MetaMask may have submitted a transaction. Copy its hash from Activity into Verify receipts below; do not submit again.",
    );

  async function confirmPending() {
    if (!journal.pending) return;
    const kind = journal.pending.step;
    const receipt = await rpc.waitForTransactionReceipt({
      hash: journal.pending.hash,
      confirmations: 2,
      timeout: 120_000,
      onReplaced: ({ transactionReceipt }) => {
        journal = {
          ...journal,
          pending: { step: kind, hash: transactionReceipt.transactionHash },
        };
        save(journal);
      },
    });
    const candidate = {
      deploymentHash:
        kind === "deploy" ? receipt.transactionHash : journal.deploymentHash,
      ...(kind === "fund" ? { fundingHash: receipt.transactionHash } : {}),
    };
    const result = await prepare(candidate);
    if (
      !result.verified ||
      result.verified.deploymentHash !== candidate.deploymentHash ||
      (kind === "fund" && result.verified.fundingHash !== candidate.fundingHash)
    )
      throw new Error(
        "The server has not verified the exact transaction. Keep its hash for recovery.",
      );
    journal = { fingerprint: plan.fingerprint, ...candidate };
    save(journal);
    return result;
  }

  if (journal.pending) {
    if (action !== "resume")
      throw new Error("Resume and verify the pending transaction first.");
    const result = await confirmPending();
    report(
      "PASS — transaction and paused contract independently verified. GLOW gameplay remains closed.",
    );
    return { prepared: result!, estimate: undefined };
  }
  const hashes = {
    deploymentHash: journal.deploymentHash,
    fundingHash: journal.fundingHash,
  };
  const prepared = await prepare(hashes);
  if (prepared.fingerprint !== plan.fingerprint)
    throw new Error("The server plan changed. Reload and review it again.");
  if (action === "resume" || prepared.step === "done") {
    report(
      prepared.step === "done"
        ? "PASS — paused deployment and reserve funding verified."
        : "Saved receipts checked. Estimate the next transaction to continue.",
    );
    return { prepared, estimate: undefined };
  }
  if (
    !prepared.transaction ||
    prepared.step !== (journal.deploymentHash ? "fund" : "deploy")
  )
    throw new Error("The prepared step does not match the saved receipts.");
  const expected =
    prepared.step === "deploy"
      ? plan.deployment
      : prepared.verified &&
        gameFundingTransaction(plan, prepared.verified.economy);
  if (
    !expected ||
    JSON.stringify(prepared.transaction) !== JSON.stringify(expected)
  )
    throw new Error("The transaction differs from the reviewed plan.");
  const tx = { to: expected.to ?? undefined, data: expected.data, value: 0n };
  const gas =
    ((await rpc.estimateGas({ ...tx, account: plan.owner })) * 120n) / 100n;
  const fees = await rpc.estimateFeesPerGas();
  if (
    !fees.maxFeePerGas ||
    fees.maxPriorityFeePerGas === undefined ||
    fees.maxPriorityFeePerGas > fees.maxFeePerGas
  )
    throw new Error("Sepolia fee estimate is unavailable.");
  const maximumFee = gas * fees.maxFeePerGas;
  const estimate = { step: prepared.step, gas, maximumFee, at: Date.now() };
  if (action === "estimate") return { prepared, estimate };
  if (
    !reviewed ||
    reviewed.step !== prepared.step ||
    Date.now() - reviewed.at > 120_000 ||
    maximumFee > (reviewed.maximumFee * 120n) / 100n
  )
    throw new Error(
      "Estimate and review this step again before sending it to MetaMask.",
    );
  await requireWallet();
  if ((await rpc.getBalance({ address: plan.owner })) < maximumFee)
    throw new Error("Insufficient Sepolia test ETH for this network fee.");
  // Persist uncertainty before prompting. Only an explicit wallet rejection can
  // clear it without a verified receipt; transport errors may follow a broadcast.
  save({ ...journal, inFlight: prepared.step });
  report(
    "Review the transaction in MetaMask. Confirm only on Ethereum Sepolia.",
  );
  let submitted: Hex;
  try {
    submitted = await wallet.sendTransaction({
      ...tx,
      account: plan.owner,
      chain: sepolia,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  } catch (error) {
    if (wasUserRejected(error)) save(journal);
    throw error;
  }
  journal = { ...journal, pending: { step: prepared.step, hash: submitted } };
  save(journal);
  report(
    "Submitted. Waiting for two confirmations and independent server verification.",
  );
  const result = await confirmPending();
  report("PASS — transaction and paused contract independently verified.");
  return { prepared: result!, estimate: undefined };
}
