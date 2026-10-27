"use client";
import { useState } from "react";
import {
  useConnection,
  useReadContract,
  useReadContracts,
  useWalletClient,
} from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { contracts, CHAIN_ID } from "@/lib/chain";
export function TokenOverview() {
  const { address, chainId } = useConnection();
  const { data: wallet } = useWalletClient();
  const [watchStatus, setWatchStatus] = useState("");
  const [watchPending, setWatchPending] = useState(false);
  const token = contracts.token;
  const metadata = useReadContracts({
    contracts: token
      ? (["name", "symbol", "decimals"] as const).map((functionName) => ({
          address: token,
          abi: erc20Abi,
          functionName,
          chainId: CHAIN_ID,
        }))
      : [],
    query: { enabled: !!token },
  });
  const name = metadata.data?.[0]?.result;
  const symbol = metadata.data?.[1]?.result;
  const decimals = metadata.data?.[2]?.result;
  const verified =
    name === "Lantern Vale Glow" && symbol === "GLOW" && decimals === 18;
  async function watchToken() {
    if (!token || !wallet || !verified || watchPending) return;
    setWatchPending(true);
    try {
      if ((await wallet.getChainId()) !== CHAIN_ID)
        throw new Error("Switch to Ethereum Sepolia first.");
      const added = await wallet.watchAsset({
        type: "ERC20",
        options: { address: token, symbol: "GLOW", decimals: 18 },
      });
      setWatchStatus(
        added ? "GLOW added to your wallet." : "Token tracking was declined.",
      );
    } catch {
      setWatchStatus(
        "The token was not added. Check your wallet and try again.",
      );
    } finally {
      setWatchPending(false);
    }
  }
  const supply = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "totalSupply",
    chainId: CHAIN_ID,
    query: { enabled: !!token, refetchInterval: 15_000 },
  });
  const balance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!token && !!address, refetchInterval: 15_000 },
  });
  return (
    <section className="panel">
      <p className="eyebrow">The token behind the trail</p>
      <h2>
        Lantern Vale Glow <span className="badge">GLOW</span>
      </h2>
      <p className="muted">
        A test token for adventures, supplies and a little friendly exploration.
      </p>
      {!token ? (
        <p className="status">
          GLOW has not been deployed for this app yet. Token balances and the
          faucet will become available after deployment.
        </p>
      ) : (
        <>
          <p className="address">{token}</p>
          <p className="muted">
            {verified
              ? "Onchain metadata verified: Lantern Vale Glow · GLOW · 18 decimals."
              : "Token metadata is unavailable or does not match GLOW. Balances are withheld."}
          </p>
          <a
            href={`https://sepolia.etherscan.io/address/${token}`}
            target="_blank"
            rel="noreferrer"
          >
            View token on Etherscan ↗
          </a>
          <p>
            Total supply:{" "}
            {verified && supply.data !== undefined
              ? formatUnits(supply.data, 18)
              : "Unavailable"}{" "}
            GLOW
          </p>
          <p>
            Your balance:{" "}
            {verified && balance.data !== undefined
              ? formatUnits(balance.data, 18)
              : address
                ? "Unavailable"
                : "Connect your wallet"}{" "}
            GLOW
          </p>
          {(supply.isError || balance.isError) && (
            <p role="alert">Unable to read token data. Please retry shortly.</p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={
              !verified || !wallet || chainId !== CHAIN_ID || watchPending
            }
            onClick={() => void watchToken()}
          >
            {watchPending ? "Review in MetaMask…" : "Add GLOW to MetaMask"}
          </button>
          <p role="status">{watchStatus}</p>
        </>
      )}
      <p className="muted">
        Maximum circulating supply: 1,000,000 GLOW by contract design. No
        intended monetary value.
      </p>
    </section>
  );
}
