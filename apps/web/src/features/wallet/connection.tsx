"use client";
import { useEffect, useState } from "react";
import {
  useBalance,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { formatEther } from "viem";
import { CHAIN_ID } from "@/lib/chain";

export function WalletConnection({ compact = false }: { compact?: boolean }) {
  const { address, chainId, isConnected, status } = useConnection();
  const connect = useConnect();
  const connectors = useConnectors();
  const disconnect = useDisconnect();
  const changeChain = useSwitchChain();
  const balance = useBalance({
    address,
    chainId: CHAIN_ID,
    query: {
      enabled: !!address && chainId === CHAIN_ID,
      refetchInterval: 15_000,
    },
  });
  const error = connect.error || changeChain.error;
  const metaMask = connectors.find(
    (c) =>
      c.id === "io.metamask" || c.id === "metaMask" || c.name === "MetaMask",
  );
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    // A configured connector can exist even when this browser has no extension.
    void Promise.resolve(metaMask?.getProvider())
      .then((provider) => {
        if (active) setAvailable(!!provider);
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [metaMask]);
  return (
    <div className={compact ? "wallet-compact" : "wallet-panel"}>
      {!isConnected ? (
        <>
          <button
            type="button"
            disabled={
              connect.isPending ||
              status === "reconnecting" ||
              available !== true
            }
            onClick={() =>
              metaMask &&
              connect.mutate({ connector: metaMask, chainId: CHAIN_ID })
            }
          >
            {connect.isPending
              ? "Approve in MetaMask…"
              : status === "reconnecting"
                ? "Reconnecting…"
                : "Connect Wallet"}
          </button>
          {!compact && (
            <p className="muted">
              Connect your MetaMask account to read its Sepolia balance.
              Connecting does not transfer tokens.
            </p>
          )}
          {available === false && (
            <p role="status">
              MetaMask is not available in this browser. Open this site in the
              browser where MetaMask is installed.
            </p>
          )}
        </>
      ) : (
        <>
          {!compact && <p className="eyebrow">Your connected wallet</p>}
          <span className="address" title={address}>
            {compact
              ? `${address?.slice(0, 6)}…${address?.slice(-4)}`
              : address}
          </span>
          <span className={chainId === CHAIN_ID ? "badge" : "badge warning"}>
            {chainId === CHAIN_ID
              ? "Ethereum Sepolia · 11155111"
              : `Wrong network · ${chainId}`}
          </span>
          {chainId !== CHAIN_ID ? (
            <button
              type="button"
              disabled={changeChain.isPending}
              onClick={() => changeChain.mutate({ chainId: CHAIN_ID })}
            >
              Switch to Sepolia
            </button>
          ) : (
            !compact && (
              <p className="balance">
                {balance.isPending
                  ? "Reading balance…"
                  : balance.isError
                    ? "Balance unavailable — retry below."
                    : balance.data
                      ? `${formatEther(balance.data.value)} Sepolia ETH`
                      : "Balance unavailable"}
              </p>
            )
          )}
          {!compact && (
            <button
              type="button"
              className="secondary"
              onClick={() => void balance.refetch()}
            >
              Refresh balance
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => disconnect.mutate()}
          >
            Disconnect
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error.message.includes("rejected")
            ? "Connection was declined. You can try again when ready."
            : error.message.split("\n")[0]}
        </p>
      )}
    </div>
  );
}
