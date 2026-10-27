"use client";
import { useEffect, useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { erc20Abi, formatUnits, isAddressEqual } from "viem";
import { contracts, faucetAbi, CHAIN_ID } from "@/lib/chain";
import { useTransaction, TransactionStatus } from "./transactions";
export function Faucet() {
  const { address, chainId } = useConnection();
  const tx = useTransaction();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Math.floor(Date.now() / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);
  const next = useReadContract({
    address: contracts.faucet,
    abi: faucetAbi,
    functionName: "nextClaimAt",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!address && !!contracts.faucet,
      refetchInterval: 15_000,
    },
  });
  const pool = useReadContract({
    address: contracts.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: contracts.faucet ? [contracts.faucet] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!contracts.token && !!contracts.faucet,
      refetchInterval: 15_000,
    },
  });
  const amount = useReadContract({
    address: contracts.faucet,
    abi: faucetAbi,
    functionName: "CLAIM_AMOUNT",
    chainId: CHAIN_ID,
    query: { enabled: !!contracts.faucet },
  });
  const token = useReadContract({
    address: contracts.faucet,
    abi: faucetAbi,
    functionName: "token",
    chainId: CHAIN_ID,
    query: { enabled: !!contracts.faucet },
  });
  const cooldown = useReadContract({
    address: contracts.faucet,
    abi: faucetAbi,
    functionName: "COOLDOWN",
    chainId: CHAIN_ID,
    query: { enabled: !!contracts.faucet },
  });
  const verified =
    amount.data === 5n * 10n ** 18n &&
    cooldown.data === 86400n &&
    !!token.data &&
    !!contracts.token &&
    isAddressEqual(token.data, contracts.token);
  const remaining =
    next.data === undefined ? 0 : Math.max(0, Number(next.data) - now);
  const funded =
    verified &&
    pool.data !== undefined &&
    amount.data !== undefined &&
    pool.data >= amount.data;
  async function claim() {
    try {
      await tx.send({
        address: contracts.faucet!,
        abi: faucetAbi,
        functionName: "claim",
      });
      await Promise.all([next.refetch(), pool.refetch()]);
    } catch {
      /* The transaction status contains the failure. */
    }
  }
  return (
    <section className="panel">
      <h2>Daily GLOW faucet</h2>
      <p>
        Claim 5 GLOW once every 24 hours per wallet. Sepolia ETH pays the
        network fee.
      </p>
      {!contracts.faucet ? (
        <p className="status">The faucet is awaiting deployment and funding.</p>
      ) : (
        <>
          <p>
            Pool:{" "}
            {pool.data === undefined
              ? "Unavailable"
              : formatUnits(pool.data, 18) + " GLOW"}
          </p>
          <p>
            {remaining
              ? `Next claim in ${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m ${remaining % 60}s`
              : next.data !== undefined
                ? "Your wallet cooldown has ended."
                : "Connect your wallet to check eligibility."}
          </p>
          <button
            type="button"
            disabled={
              tx.busy ||
              !address ||
              chainId !== CHAIN_ID ||
              remaining > 0 ||
              !funded ||
              next.data === undefined
            }
            onClick={() => void claim()}
          >
            Claim 5 GLOW
          </button>
          {verified && pool.data !== undefined && !funded && (
            <p>The faucet needs more GLOW before it can dispense tokens.</p>
          )}
          {!verified && (
            <p role="status">
              The faucet amount, cooldown and token must match the approved
              configuration before claiming.
            </p>
          )}
          {(next.isError ||
            pool.isError ||
            amount.isError ||
            cooldown.isError ||
            token.isError) && (
            <p role="alert">
              The faucet could not be read. Please retry shortly.
            </p>
          )}
          <TransactionStatus {...tx} />
        </>
      )}
      <a
        href="https://ethereum.org/en/developers/docs/networks/#sepolia"
        target="_blank"
        rel="noreferrer"
      >
        About Sepolia and test ETH ↗
      </a>
    </section>
  );
}
