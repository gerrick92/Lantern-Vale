"use client";
import { useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CHAIN_ID } from "@/lib/chain";
import { WalletConnection } from "./connection";

export function useWalletOwnership() {
  const { address, chainId, isConnected } = useConnection();
  const wallet = useQuery({
    queryKey: ["account-wallet-link"],
    queryFn: () => api<{ wallet: { address: string } | null }>("/api/wallet"),
    retry: false,
  });
  const linked = wallet.data?.wallet?.address;
  const matches = !!linked && linked.toLowerCase() === address?.toLowerCase();
  return {
    wallet,
    address,
    chainId,
    linked,
    matches,
    ready: isConnected && chainId === CHAIN_ID && matches && !wallet.isError,
  };
}

export function WalletOwnership({
  allowUnlink = true,
}: {
  allowUnlink?: boolean;
}) {
  const { wallet, address, chainId, linked, matches } = useWalletOwnership();
  const sign = useSignMessage();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function link() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (!address || chainId !== CHAIN_ID)
        throw new Error("Connect your wallet on Ethereum Sepolia.");
      const challenge = await api<{ id: string; message: string }>(
        "/api/wallet/challenge",
        { address },
      );
      const signature = await sign.mutateAsync({ message: challenge.message });
      await api("/api/wallet/verify", { id: challenge.id, signature });
      await wallet.refetch();
      setMessage("Wallet linked to your account.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Wallet linking failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <WalletConnection compact />
      <p className="small-note">
        Link your connected wallet to this account with a MetaMask signature.
        This message does not spend GLOW or ETH.
      </p>
      <p className={linked ? "address" : "muted"}>
        {wallet.isPending
          ? "Checking your account's wallet…"
          : wallet.isError
            ? "Could not load your linked wallet. Try checking again."
            : linked
              ? `Linked to your account: ${linked}`
              : "No wallet linked to your account yet."}
      </p>
      {linked && address && !matches && (
        <p className="small-note">
          The connected wallet differs from the wallet linked to your account.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={
            busy ||
            wallet.isPending ||
            wallet.isError ||
            !address ||
            chainId !== CHAIN_ID ||
            matches
          }
          onClick={() => void link()}
        >
          {busy
            ? "Waiting for MetaMask…"
            : matches
              ? "Wallet linked"
              : "Link wallet to account"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || wallet.isFetching}
          onClick={() => void wallet.refetch()}
        >
          Check linked wallet
        </button>
        {allowUnlink && (
          <button
            type="button"
            className="text-button"
            disabled={busy || !linked}
            onClick={() =>
              void api("/api/wallet", undefined, "DELETE")
                .then(async () => {
                  await wallet.refetch();
                  setMessage(
                    "Wallet unlinked. Existing rounds stay bound to their original payer.",
                  );
                })
                .catch((error) => setMessage(error.message))
            }
          >
            Unlink wallet
          </button>
        )}
      </div>
      <p role="status">{message}</p>
    </>
  );
}
