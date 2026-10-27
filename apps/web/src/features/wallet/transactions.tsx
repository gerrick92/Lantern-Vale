"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { isAddressEqual, type Abi, type Address, type Hash } from "viem";
import { sepolia } from "viem/chains";
import { CHAIN_ID } from "@/lib/chain";
import { waitForJournaledTransaction } from "./transaction-journal";
export function useTransaction() {
  const queries = useQueryClient();
  const connection = useConnection();
  const { data: wallet } = useWalletClient();
  const rpc = usePublicClient({ chainId: CHAIN_ID });
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState<Hash>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function send(
    input: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
    },
    onSubmitted?: (hash: Hash) => void,
  ) {
    if (pending.current)
      throw new Error("A transaction is already in progress.");
    pending.current = true;
    setBusy(true);
    setHash(undefined);
    setStatus("Checking the connected MetaMask account…");
    try {
      if (
        !wallet ||
        !rpc ||
        !connection.address ||
        connection.chainId !== CHAIN_ID
      )
        throw new Error("Connect the paying wallet on Ethereum Sepolia.");
      const account = connection.address;
      const current = await wallet.getAddresses();
      if (
        (await wallet.getChainId()) !== CHAIN_ID ||
        !current[0] ||
        !isAddressEqual(current[0], account)
      )
        throw new Error("Your wallet changed. Review this transaction again.");
      setStatus("Checking Sepolia and network fees…");
      if ((await rpc.getChainId()) !== CHAIN_ID)
        throw new Error("The read provider is not on Sepolia.");
      if ((await rpc.getBalance({ address: account })) === 0n)
        throw new Error("You need Sepolia ETH for network fees.");
      setStatus("Checking the transaction…");
      const simulation = await rpc.simulateContract({ ...input, account });
      setStatus("Review and confirm in MetaMask.");
      const submitted = await wallet.writeContract({
        ...simulation.request,
        chain: sepolia,
      });
      setHash(submitted);
      onSubmitted?.(submitted);
      setStatus("Submitted. Waiting for two confirmations…");
      const receipt = await waitForJournaledTransaction(
        rpc,
        account,
        submitted,
        (replacementHash, reason) => {
          setHash(replacementHash);
          if (reason === "repriced") onSubmitted?.(replacementHash);
          setStatus(
            reason === "repriced"
              ? "Fee updated. Waiting for confirmation…"
              : "Transaction was replaced. Checking the receipt…",
          );
        },
      );
      setStatus("Confirmed on Ethereum Sepolia.");
      // Refresh mounted balance and supply views only after canonical confirmation.
      await queries.invalidateQueries({
        predicate: ({ queryKey }) =>
          [
            "readContract",
            "readContracts",
            "balance",
            "glow-supply-ledger",
          ].includes(String(queryKey[0])),
      });
      return receipt;
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message.split("\n")[0]
          : "Transaction failed.",
      );
      throw error;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { send, status, hash, busy };
}
export function TransactionStatus({
  status,
  hash,
}: {
  status: string;
  hash?: Hash;
}) {
  return (
    <div role="status" className="status">
      <p>{status || "Transactions require your approval in MetaMask."}</p>
      {hash && (
        <a
          href={`https://sepolia.etherscan.io/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction on Etherscan ↗
        </a>
      )}
    </div>
  );
}
