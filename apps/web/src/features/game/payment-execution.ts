import {
  erc20Abi,
  isAddressEqual,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { GLOW_PRICE, settlementAbi } from "@/lib/settlement";
import {
  paymentCall,
  paymentCalldata,
  readPayment,
  savePayment,
  type JournalStorage,
  type PaymentPlan,
  type PaymentRecord,
} from "./payment-journal";

type Call = {
  address: Address;
  abi: typeof erc20Abi | typeof settlementAbi;
  functionName: string;
  args: readonly unknown[];
};
type Dependencies = {
  rpc: Pick<
    PublicClient,
    | "getChainId"
    | "readContract"
    | "getTransaction"
    | "getBlock"
    | "getBlockNumber"
    | "waitForTransactionReceipt"
  >;
  storage: JournalStorage;
  assertWallet(): Promise<void>;
  onProgress?(message: string): void;
  onWalletStep?(step: "approval" | "payment"): void;
  send(
    call: Call,
    onSubmitted: (hash: Hash) => void,
  ): Promise<{
    transactionHash: Hash;
    status: "success" | "reverted";
    blockHash: Hash;
    blockNumber: bigint;
  }>;
  register(hash: Hash, plan: PaymentPlan): Promise<{ roundId: string }>;
};

function wasDeclined(error: unknown): boolean {
  for (
    let depth = 0;
    depth < 10 && error && typeof error === "object";
    depth++
  ) {
    if ("code" in error && error.code === 4001) return true;
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}

// Storage and the plan are recovery hints, never payment evidence. Registration
// independently verifies the receipt and grants the entitlement on the server.
export async function executePayment(plan: PaymentPlan, deps: Dependencies) {
  const { rpc, storage } = deps;
  const previous = readPayment(
    storage,
    plan.wallet as Address,
    plan.contract as Address,
  );
  if (
    previous &&
    !["recorded", "expired"].includes(previous.stage) &&
    (previous.plan.paymentId !== plan.paymentId ||
      !["prepared", "approving"].includes(previous.stage))
  )
    throw new Error("An earlier payment needs recovery. Do not pay again.");
  let record: PaymentRecord =
    previous?.plan.paymentId === plan.paymentId
      ? previous
      : { version: 1, plan, stage: "prepared" };
  savePayment(storage, record);
  const save = (patch: Partial<PaymentRecord>) => {
    record = { ...record, ...patch };
    savePayment(storage, record);
  };
  deps.onProgress?.("Checking the connected MetaMask account…");
  await deps.assertWallet();
  deps.onProgress?.("Checking the Sepolia connection…");
  if ((await rpc.getChainId()) !== 11155111)
    throw new Error("The provider is not on Sepolia.");
  const checkDeadline = async () => {
    if ((await rpc.getBlock()).timestamp >= BigInt(plan.deadline))
      throw new Error(
        "This review expired. Recover any submitted payment or release the unpaid review before continuing.",
      );
  };
  deps.onProgress?.("Checking the payment deadline…");
  await checkDeadline();
  if (record.stage === "approving") {
    if (!record.approvalHash)
      throw new Error(
        "The previous allowance request is unresolved. Check MetaMask Activity before releasing this review after expiry.",
      );
    deps.onProgress?.("Checking your previous allowance confirmation…");
    const approval = await rpc.waitForTransactionReceipt({
      hash: record.approvalHash as Hash,
      confirmations: 2,
    });
    if (approval.status !== "success")
      throw new Error(
        "The previous allowance failed. Release this review after expiry before starting again.",
      );
    save({ stage: "prepared", approvalHash: undefined });
    await checkDeadline();
  }
  const address = plan.contract as Address;
  const tokenAddress = plan.token as Address;
  const walletAddress = plan.wallet as Address;
  deps.onProgress?.("Checking your GLOW balance and allowance…");
  const [token, paused, balance, allowance, priorRound] = await Promise.all([
    rpc.readContract({ address, abi: settlementAbi, functionName: "token" }),
    rpc.readContract({ address, abi: settlementAbi, functionName: "paused" }),
    rpc.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
    rpc.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletAddress, address],
    }),
    rpc.readContract({
      address,
      abi: settlementAbi,
      functionName: "paymentRound",
      args: [walletAddress, plan.paymentId as Hash],
    }),
  ]);
  if (
    !isAddressEqual(token, tokenAddress) ||
    paused ||
    balance < GLOW_PRICE ||
    priorRound !== 0n
  )
    throw new Error(
      "The payment is unavailable or already recorded onchain. Recover it before continuing.",
    );
  const approve = async (amount: bigint) => {
    deps.onWalletStep?.("approval");
    deps.onProgress?.("Preparing the GLOW allowance request…");
    await deps.assertWallet();
    save({ stage: "approving", approvalHash: undefined });
    try {
      await deps.send(
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [address, amount],
        },
        (approvalHash) => save({ approvalHash }),
      );
    } catch (error) {
      if (wasDeclined(error) && !record.approvalHash)
        save({ stage: "prepared" });
      throw error;
    }
    save({ stage: "prepared", approvalHash: undefined });
  };
  if (allowance !== GLOW_PRICE) {
    if (allowance > 0n) await approve(0n);
    await approve(GLOW_PRICE);
  }
  deps.onProgress?.("Preparing your 1 GLOW game payment…");
  deps.onWalletStep?.("payment");
  await deps.assertWallet();
  await checkDeadline();
  // Re-read after the wallet prompt: another tab may have changed the allowance.
  if (
    (await rpc.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [walletAddress, address],
    })) !== GLOW_PRICE
  )
    throw new Error(
      "The allowance changed. Review the saved payment before continuing.",
    );
  save({ stage: "submitting" });
  const receipt = await deps
    .send(paymentCall(plan), (hash) => save({ stage: "submitted", hash }))
    .catch((error: unknown) => {
      // Only an explicit provider rejection is safe to retry. Lost responses
      // remain ambiguous and must use receipt recovery instead of another send.
      if (wasDeclined(error) && !record.hash) save({ stage: "prepared" });
      throw error;
    });
  save({ hash: receipt.transactionHash, stage: "submitted" });
  deps.onProgress?.("Verifying your confirmed payment…");
  const [tx, block, head] = await Promise.all([
    rpc.getTransaction({ hash: receipt.transactionHash }),
    rpc.getBlock({ blockNumber: receipt.blockNumber }),
    rpc.getBlockNumber(),
  ]);
  if (
    receipt.status !== "success" ||
    !tx.to ||
    !isAddressEqual(tx.to, address) ||
    !isAddressEqual(tx.from, walletAddress) ||
    tx.chainId !== 11155111 ||
    tx.value !== 0n ||
    tx.input.toLowerCase() !== paymentCalldata(plan).toLowerCase() ||
    tx.blockHash !== receipt.blockHash ||
    block.hash !== receipt.blockHash ||
    head < receipt.blockNumber + 1n
  )
    throw new Error(
      "The receipt does not match the reviewed payment. Reconciliation is required.",
    );
  const registered = await deps.register(receipt.transactionHash, plan);
  save({ stage: "recorded", roundId: registered.roundId });
  return registered;
}

export async function recoverPayment(
  record: PaymentRecord,
  deps: Pick<Dependencies, "storage" | "register">,
  findHash: (plan: PaymentPlan) => Promise<Hash>,
) {
  // This function never requests a wallet transaction, even after a timeout.
  const hash =
    (record.hash as Hash | undefined) ?? (await findHash(record.plan));
  const registered = await deps.register(hash, record.plan);
  savePayment(deps.storage, {
    ...record,
    hash,
    stage: "recorded",
    roundId: registered.roundId,
  });
  return registered;
}
