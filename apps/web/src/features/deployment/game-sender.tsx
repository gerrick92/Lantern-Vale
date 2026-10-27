"use client";

import { useRef, useState } from "react";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { formatEther, isAddressEqual } from "viem";
import { sepolia } from "viem/chains";
import { api } from "@/lib/api";
import { WalletConnection } from "@/features/wallet/connection";
import type { SavedGameReview } from "./game-plan";
import type { GameDeploymentVerification } from "./game-verification";
import type { PreparedGameTransaction } from "./game-transaction";
import {
  adoptGameReceipts,
  executeGameTransaction,
  readGameJournal,
  type GameEstimate,
  type GameJournal,
} from "./game-execution";

export function GameDeploymentSender(props: {
  plan: SavedGameReview;
  verified?: GameDeploymentVerification;
}) {
  const { address, chainId } = useConnection();
  return (
    <GameSenderSession
      key={`${address}:${chainId}:${props.plan.fingerprint}`}
      {...props}
    />
  );
}

function GameSenderSession({
  plan,
  verified,
}: {
  plan: SavedGameReview;
  verified?: GameDeploymentVerification;
}) {
  const { address, chainId } = useConnection();
  const { data: wallet } = useWalletClient();
  const rpc = usePublicClient({ chainId: sepolia.id });
  const [prepared, setPrepared] = useState<PreparedGameTransaction>();
  const [estimate, setEstimate] = useState<GameEstimate>();
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [journal, setJournal] = useState<GameJournal>();
  const locked = useRef(false);
  const key = `lantern-vale:game-deployment:11155111:${plan.owner.toLowerCase()}`;
  const canUse =
    !!wallet &&
    !!rpc &&
    !!address &&
    chainId === sepolia.id &&
    isAddressEqual(address, plan.owner);
  const save = (value: GameJournal) => {
    localStorage.setItem(key, JSON.stringify(value));
    setJournal(value);
  };
  async function run(action: "resume" | "estimate" | "submit" | "adopt") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw new Error("This browser must support transaction locking.");
      await navigator.locks.request(
        key,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Another tab is processing this deployment. Continue there.",
            );
          if (!canUse || !wallet || !rpc)
            throw new Error(
              "Connect the reviewed owner wallet on Ethereum Sepolia.",
            );
          const read = () =>
            readGameJournal(localStorage.getItem(key), plan.fingerprint);
          const prepare = (hashes: {
            deploymentHash?: `0x${string}`;
            fundingHash?: `0x${string}`;
          }) =>
            api<PreparedGameTransaction>("/dev/deploy/game/prepare", {
              fingerprint: plan.fingerprint,
              ...hashes,
            });
          if (action === "adopt") {
            if (!verified || verified.fingerprint !== plan.fingerprint)
              throw new Error("Verify the exact receipts below first.");
            const current = read();
            const recovered = adoptGameReceipts(current, {
              deploymentHash: verified.deploymentHash,
              ...(verified.fundingHash
                ? { fundingHash: verified.fundingHash }
                : {}),
            });
            const checked = await prepare(recovered);
            save(recovered);
            setPrepared(checked);
            setEstimate(undefined);
            setApproved(false);
            setMessage(
              "Verified receipts saved. The next step is ready for review.",
            );
            return;
          }
          if (action === "submit" && !approved)
            throw new Error("Authorize this exact step first.");
          if (action !== "resume" && !prepared)
            throw new Error("Check saved transactions first.");
          const result = await executeGameTransaction(
            { plan, wallet, rpc, read, save, prepare, report: setMessage },
            action,
            estimate,
          );
          setJournal(read());
          setPrepared(result.prepared);
          setEstimate(result.estimate);
          if (action !== "estimate") setApproved(false);
        },
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.split("\n")[0]
          : "Transaction processing failed. Keep the saved receipts.",
      );
      setEstimate(undefined);
      setApproved(false);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const next = prepared?.step;
  return (
    <section className="panel" aria-labelledby="game-send-title">
      <h2 id="game-send-title">Deploy and fund the paused game</h2>
      <WalletConnection />
      <p>
        Two owner-confirmed transactions: deploy the paused game, then mint{" "}
        {plan.bonusTokens} GLOW into its bonus reserve. Existing player balances
        and the faucet pool are unchanged. Only Sepolia test ETH pays the
        network fees.
      </p>
      <p>This tool cannot unpause the contract or enable GLOW gameplay.</p>
      {!canUse && <p>Use the owner address shown in the review above.</p>}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || !canUse}
          onClick={() => void run("resume")}
        >
          Check or resume saved transactions
        </button>
        {verified && (
          <button
            type="button"
            className="secondary"
            disabled={busy || !canUse}
            onClick={() => void run("adopt")}
          >
            Use verified receipts
          </button>
        )}
      </div>
      {next && next !== "done" && (
        <>
          <h3>
            {next === "deploy"
              ? "1. Deploy paused game contract"
              : `2. Fund reserve with ${plan.bonusTokens} GLOW`}
          </h3>
          {prepared?.verified && (
            <p className="address">
              Verified game address: {prepared.verified.economy}
            </p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy || !canUse}
            onClick={() => void run("estimate")}
          >
            Estimate next transaction
          </button>
          {estimate && (
            <>
              <p>
                Estimated maximum network fee:{" "}
                {formatEther(estimate.maximumFee)} Sepolia ETH.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                {next === "deploy"
                  ? "I authorize this paused Sepolia game deployment."
                  : `I authorize minting ${plan.bonusTokens} GLOW to this verified game reserve.`}
              </label>
              <button
                type="button"
                disabled={busy || !canUse || !approved}
                onClick={() => void run("submit")}
              >
                Review next transaction in MetaMask
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p role="status" aria-live="polite">
        {busy ? message || "Checking…" : message}
      </p>
      {journal && (journal.pending || journal.deploymentHash) && (
        <details>
          <summary>Saved transaction hashes</summary>
          <pre style={{ overflowX: "auto" }}>
            {JSON.stringify(journal, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
