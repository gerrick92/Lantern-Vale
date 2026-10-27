"use client";

import { useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { SavedGameReview } from "./game-plan";
import type { GameDeploymentVerification } from "./game-verification";
import { GameDeploymentSender } from "./game-sender";

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GameDeploymentPanel({ plan }: { plan: SavedGameReview }) {
  const [deploymentHash, setDeploymentHash] = useState("");
  const [fundingHash, setFundingHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState<GameDeploymentVerification>();
  const locked = useRef(false);
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setVerified(undefined);
    try {
      setVerified(
        await api<GameDeploymentVerification>("/dev/deploy/game/verify", {
          fingerprint: plan.fingerprint,
          deploymentHash: deploymentHash.trim(),
          ...(fundingHash.trim() ? { fundingHash: fundingHash.trim() } : {}),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel" aria-labelledby="game-plan-title">
        <h2 id="game-plan-title">Deployment record</h2>
        <p>
          The existing GLOW token and faucet are already deployed. This separate
          contract holds round deposits and victory bonuses when play is
          enabled.
        </p>
        <dl>
          {Object.entries({
            Network: "Ethereum Sepolia · 11155111",
            Owner: plan.owner,
            "Existing GLOW token": plan.token,
            "Existing faucet": plan.faucet,
            "Restricted signer": plan.signer,
            "Reviewed bonus reserve": `${plan.bonusTokens} GLOW`,
          }).map(([label, value]) => (
            <div key={label}>
              <dt>
                <strong>{label}</strong>
              </dt>
              <dd className="address">{value}</dd>
            </div>
          ))}
        </dl>
        <details>
          <summary>Review identity and prerequisites</summary>
          <p>
            Prepared from a historical snapshot at block {plan.blockNumber},{" "}
            <time dateTime={plan.checkedAt}>{plan.checkedAt}</time>. Receipt
            verification reads the chain again.
          </p>
          <p className="address">Plan fingerprint: {plan.fingerprint}</p>
          <p className="address">
            Compiled artifact SHA-256: {plan.artifactSha256}
          </p>
          <ul>
            {plan.gates.map((gate) => (
              <li key={gate}>{gate}</li>
            ))}
          </ul>
        </details>
        <p>
          This is the original paused-deployment review. The existing deployment
          and funding are complete. Use the separate acceptance control above
          for activation; do not deploy another game contract.
        </p>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => download("lantern-vale-game-review.json", plan)}
          >
            Download unsigned review
          </button>
        </div>
      </section>
      <GameDeploymentSender plan={plan} verified={verified} />
      <section className="panel" aria-labelledby="verify-game-title">
        <h2 id="verify-game-title">Verify deployment receipts</h2>
        <p>
          After an authorized deployment, check its public transaction hash
          here. Add the funding hash after minting the agreed reserve.
          Verification never sends a transaction or enables the game.
        </p>
        <form onSubmit={(event) => void verify(event)}>
          <label htmlFor="game-deployment-hash">
            Deployment transaction hash
          </label>
          <input
            id="game-deployment-hash"
            required
            pattern="0x[0-9a-fA-F]{64}"
            maxLength={66}
            value={deploymentHash}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setDeploymentHash(event.target.value);
              setVerified(undefined);
              setError("");
            }}
          />
          <label htmlFor="game-funding-hash">
            Funding transaction hash (optional)
          </label>
          <input
            id="game-funding-hash"
            pattern="0x[0-9a-fA-F]{64}"
            maxLength={66}
            value={fundingHash}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setFundingHash(event.target.value);
              setVerified(undefined);
              setError("");
            }}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Verifying receipts…" : "Verify receipts"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <div role="status" aria-live="polite">
          {verified && (
            <>
              <p>
                <strong>
                  {verified.stage === "PAUSED_AND_FUNDED"
                    ? "PASS — paused contract and exact reserve funding verified."
                    : "PASS — paused contract verified. Funding is still pending."}
                </strong>
              </p>
              <p className="address">Game contract: {verified.economy}</p>
              <p>
                Verified at block {verified.blockNumber}. Paid play remains
                disabled.
              </p>
            </>
          )}
        </div>
        {verified && (
          <>
            <details>
              <summary>Verification details and limits</summary>
              <pre style={{ overflowX: "auto" }}>
                {JSON.stringify(verified, null, 2)}
              </pre>
            </details>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                download("lantern-vale-game-verification.json", verified)
              }
            >
              Download verification report
            </button>
          </>
        )}
      </section>
    </>
  );
}
