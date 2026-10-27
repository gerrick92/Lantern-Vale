import type { Address, Hash, PublicClient, ReplacementReason } from "viem";
import { sepolia } from "viem/chains";

const key = (account: Address) => `mosslight:pending:${account.toLowerCase()}`;

export function readPendingTransaction(account: Address): Hash | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key(account)) || "null");
    if (
      saved?.chainId === sepolia.id &&
      typeof saved.hash === "string" &&
      /^0x[0-9a-f]{64}$/i.test(saved.hash)
    )
      return saved.hash as Hash;
  } catch {
    // Storage is optional; an invalid local record is never a receipt.
  }
}

function remember(account: Address, hash: Hash) {
  try {
    sessionStorage.setItem(
      key(account),
      JSON.stringify({ hash, chainId: sepolia.id }),
    );
  } catch {
    // A blocked storage area must not hide a submitted transaction.
  }
}

export function clearPendingTransaction(account: Address, hash: Hash) {
  try {
    if (readPendingTransaction(account)?.toLowerCase() === hash.toLowerCase())
      sessionStorage.removeItem(key(account));
  } catch {
    // Keep the mined receipt as the source of truth.
  }
}

export async function waitForJournaledTransaction(
  rpc: Pick<PublicClient, "waitForTransactionReceipt">,
  account: Address,
  submitted: Hash,
  onReplacement: (hash: Hash, reason: ReplacementReason) => void,
) {
  let latest = submitted;
  let superseded = false;
  remember(account, submitted);
  const receipt = await rpc.waitForTransactionReceipt({
    hash: submitted,
    confirmations: 2,
    onReplaced(replacement) {
      const previous = latest;
      latest = replacement.transactionReceipt.transactionHash;
      if (replacement.reason !== "repriced") superseded = true;
      if (
        readPendingTransaction(account)?.toLowerCase() ===
        previous.toLowerCase()
      )
        remember(account, latest);
      onReplacement(latest, replacement.reason);
    },
  });
  // Reverted/cancelled transactions are final too; only timeouts keep the journal.
  clearPendingTransaction(account, latest);
  if (receipt.status !== "success" || superseded)
    throw new Error(
      superseded
        ? "The transaction was cancelled or replaced with a different action."
        : "The transaction reverted. No action was completed.",
    );
  return receipt;
}
