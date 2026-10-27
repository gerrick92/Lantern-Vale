"use client";
import { useRef, useState } from "react";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { formatEther, isAddressEqual, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { WalletConnection } from "@/features/wallet/connection";
import {
  deploymentStep,
  deploymentPlan,
  stepLabels,
  verifyStepReceipt,
  type Artifacts,
  type CompletedStep,
} from "./plan";
import {
  readJournal,
  requireSettledJournal,
  wasUserRejected,
  type DeploymentJournal,
} from "./journal";

export function DeploymentPanel(props: {
  artifacts: Artifacts;
  fingerprint: string;
}) {
  const { address, chainId } = useConnection();
  return (
    <DeploymentSession
      key={`${address}:${chainId}:${props.fingerprint}`}
      {...props}
    />
  );
}
function DeploymentSession({
  artifacts,
  fingerprint,
}: {
  artifacts: Artifacts;
  fingerprint: string;
}) {
  const { address, chainId } = useConnection();
  const { data: wallet } = useWalletClient();
  const rpc = usePublicClient({ chainId: sepolia.id });
  const [steps, setSteps] = useState<CompletedStep[]>([]);
  const [pendingHash, setPendingHash] = useState<Hex>();
  const [restored, setRestored] = useState(false);
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState(false);
  const [estimate, setEstimate] = useState<{
    gas: bigint;
    maximumFee: bigint;
  }>();
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const storageKey = `mosslight:deployment:11155111:${address?.toLowerCase()}`;
  const canUse = !!wallet && !!rpc && !!address && chainId === sepolia.id;
  const save = (journal: Omit<DeploymentJournal, "fingerprint">) =>
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...journal, fingerprint }),
    );

  async function verify(saved: CompletedStep[], trackPending = false) {
    if (!rpc || !address || (await rpc.getChainId()) !== sepolia.id)
      throw new Error("Connect to Ethereum Sepolia.");
    if (!Array.isArray(saved) || saved.length > stepLabels.length)
      throw new Error("Invalid saved deployment.");
    const verified: CompletedStep[] = [];
    for (let i = 0; i < saved.length; i++) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(saved[i]?.hash))
        throw new Error("Invalid transaction hash in deployment receipts.");
      const expected = deploymentStep(i, artifacts, address, verified);
      const receipt = await rpc.waitForTransactionReceipt({
        hash: saved[i].hash,
        confirmations: 2,
        timeout: 120_000,
        onReplaced: ({ transactionReceipt }) => {
          if (trackPending && i === saved.length - 1) {
            setPendingHash(transactionReceipt.transactionHash);
            save({
              steps: verified,
              pendingHash: transactionReceipt.transactionHash,
            });
          }
        },
      });
      const tx = await rpc.getTransaction({ hash: receipt.transactionHash });
      const canonical = await rpc.getBlock({
        blockNumber: receipt.blockNumber,
      });
      verified.push(
        verifyStepReceipt(
          expected,
          address,
          receipt,
          tx,
          canonical.hash,
          await rpc.getBlockNumber({ cacheTime: 0 }),
        ),
      );
    }
    return verified;
  }
  async function run(action: "estimate" | "submit" | "resume") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (!navigator.locks)
        throw new Error(
          "Use a browser that supports transaction locking to prevent duplicate deployment requests.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Another tab is processing this deployment. Continue in that tab.",
            );
          if (!canUse || !rpc || !wallet || !address)
            throw new Error("Connect the deployment wallet on Sepolia.");
          const accounts = await wallet.getAddresses();
          if (
            (await wallet.getChainId()) !== sepolia.id ||
            !accounts[0] ||
            !isAddressEqual(accounts[0], address)
          )
            throw new Error("Wallet changed. Review the deployment again.");
          if (action === "resume") {
            setRestored(false);
            const saved = readJournal(
              localStorage.getItem(storageKey),
              fingerprint,
            );
            setPendingHash(saved.pendingHash);
            if (saved.inFlight && !saved.pendingHash)
              requireSettledJournal(saved);
            let recovered = await verify(saved.steps);
            if (saved.pendingHash)
              recovered = await verify(
                [...recovered, { hash: saved.pendingHash }],
                true,
              );
            setSteps(recovered);
            setPendingHash(undefined);
            setEstimate(undefined);
            save({ steps: recovered });
            setRestored(true);
            setMessage(
              recovered.length
                ? "Saved receipts independently verified on Sepolia."
                : "No saved transactions. Ready to estimate the first deployment.",
            );
            return;
          }
          if (!restored || pendingHash)
            throw new Error(
              "Resume and verify the pending transaction before submitting another.",
            );
          const journal = readJournal(
            localStorage.getItem(storageKey),
            fingerprint,
          );
          requireSettledJournal(journal);
          const verified = await verify(journal.steps);
          if (verified.length !== steps.length) {
            setRestored(false);
            throw new Error(
              "Another tab advanced this deployment. Resume and verify its receipts first.",
            );
          }
          const step = deploymentStep(
            verified.length,
            artifacts,
            address,
            verified,
          );
          const gas = await rpc.estimateGas({ ...step, account: address });
          const fees = await rpc.estimateFeesPerGas();
          const maximumFee = ((gas * 120n) / 100n) * fees.maxFeePerGas;
          if (action === "estimate") {
            setEstimate({ gas, maximumFee });
            return;
          }
          if (!approved || !estimate)
            throw new Error(
              "Review the plan, estimate the transaction, and authorize deployment first.",
            );
          if ((await rpc.getBalance({ address })) < maximumFee)
            throw new Error(
              "Insufficient Sepolia ETH for the estimated network fee.",
            );
          setMessage(
            "Review this exact transaction in MetaMask. Confirm only on Ethereum Sepolia.",
          );
          save({ steps: verified, inFlight: true });
          setRestored(false);
          let hash: Hex;
          try {
            hash = await wallet.sendTransaction({
              ...step,
              account: address,
              chain: sepolia,
              gas: (gas * 120n) / 100n,
            });
          } catch (error) {
            if (wasUserRejected(error)) {
              save({ steps: verified });
              setRestored(true);
            }
            throw error;
          }
          setPendingHash(hash);
          save({ steps: verified, pendingHash: hash });
          setMessage(
            "Submitted. Waiting for two confirmations. Keep this page open.",
          );
          const completed = await verify([...verified, { hash }], true);
          setSteps(completed);
          setPendingHash(undefined);
          setEstimate(undefined);
          save({ steps: completed });
          setRestored(true);
          setMessage(
            "Transaction confirmed and matched to the compiled deployment plan.",
          );
        },
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message.split("\n")[0]
          : "Deployment step failed.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const report = {
    plan: deploymentPlan,
    chainId: sepolia.id,
    owner: address,
    fingerprint,
    steps,
  };
  return (
    <>
      <h1>GLOW token and faucet</h1>
      <section className="panel">
        <WalletConnection />
        <p>
          This publishes two contracts and sends one owner-signed mint
          transaction. It uses Sepolia ETH for gas. Your wallet key stays in
          MetaMask.
        </p>
        <p>
          Maximum outstanding supply: 1,000,000 GLOW. Initial mint: 5,000 GLOW,
          all to the faucet. Each wallet can claim 5 GLOW every 24 hours while
          the pool has funds. GLOW is a Sepolia test token with no promised cash
          value.
        </p>
        <p>
          Token owner / deployment wallet:{" "}
          <span className="address">{address || "Connect your wallet"}</span>
        </p>
        <p>
          Game activation is managed on the game contract review page. The token
          owner retains mint authority up to the cap; self-burning reopens
          capacity.
        </p>
        <p className="muted">
          Compiled artifact SHA-256:{" "}
          <span className="address">{fingerprint}</span>
        </p>
        <ol>
          {stepLabels.map((label, i) => (
            <li key={label}>
              {label}
              {steps[i] && (
                <>
                  {" "}
                  —{" "}
                  <a
                    href={`https://sepolia.etherscan.io/tx/${steps[i].hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Confirmed receipt ↗
                  </a>
                </>
              )}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="secondary"
          disabled={!canUse || busy}
          onClick={() => void run("resume")}
        >
          Resume and verify saved receipts
        </button>
        <p className="muted">
          Verify saved receipts before every new session. Keep this browser’s
          site data until the deployment report has been saved. A cancelled,
          reverted or uncertain transaction requires reconciliation before
          retrying.
        </p>
        {steps.length < stepLabels.length && (
          <>
            <p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                />{" "}
                I authorize this Sepolia-only deployment and have reviewed the
                owner and faucet allocation.
              </label>
            </p>
            <p>
              <strong>Next: {stepLabels[steps.length]}</strong>
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!canUse || busy || !restored || !!pendingHash}
                onClick={() => void run("estimate")}
              >
                Estimate next transaction
              </button>
              <button
                type="button"
                disabled={
                  !canUse ||
                  busy ||
                  !restored ||
                  !approved ||
                  !estimate ||
                  !!pendingHash
                }
                onClick={() => void run("submit")}
              >
                Review next transaction in MetaMask
              </button>
            </div>
            {estimate && (
              <p>
                Estimated gas: {estimate.gas.toString()}. Estimated fee ceiling
                with gas buffer: {formatEther(estimate.maximumFee)} Sepolia ETH.
                MetaMask shows the final fee.
              </p>
            )}
          </>
        )}
        <p role="status">{message}</p>
        {pendingHash && (
          <p className="address">Pending transaction: {pendingHash}</p>
        )}
      </section>
      {steps.length > 0 && (
        <section className="panel">
          <h2>Deployment receipts</h2>
          <p>
            These public identifiers are safe to share for verification. Do not
            enable rewards yet.
          </p>
          <pre style={{ overflowX: "auto" }}>
            {JSON.stringify(report, null, 2)}
          </pre>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(report, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "lantern-vale-sepolia-receipts.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download public receipt report
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(JSON.stringify(report, null, 2))
                .then(
                  () => setMessage("Public receipt report copied."),
                  () =>
                    setMessage("Copy failed. Select the report text instead."),
                )
            }
          >
            Copy public receipt report
          </button>
        </section>
      )}
    </>
  );
}
