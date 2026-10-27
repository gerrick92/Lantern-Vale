"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { isAddressEqual, type Address, type Hash } from "viem";
import { classes, paymentItem } from "@game/rules";
import { api } from "@/lib/api";
import { paidEconomyReady } from "@/lib/economy-release";
import {
  useTransaction,
  TransactionStatus,
} from "@/features/wallet/transactions";
import { executePayment, recoverPayment } from "./payment-execution";
import {
  canResumePayment,
  readPayment,
  savePayment,
  type PaymentPlan,
} from "./payment-journal";
import { registerWhenReady } from "./payment-registration";

export function PaymentReview({
  plan,
  enabled = paidEconomyReady,
  fresh = false,
  autoStart = false,
  onRecorded,
  onExpired,
}: {
  plan: PaymentPlan;
  enabled?: boolean;
  fresh?: boolean;
  autoStart?: boolean;
  onRecorded(roundId: string): void;
  onExpired(): void;
}) {
  const connection = useConnection();
  const rpc = usePublicClient({ chainId: 11155111 });
  const { data: wallet } = useWalletClient();
  const tx = useTransaction();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [nextBlock, setNextBlock] = useState<string>();
  const operation = useRef<AbortController | null>(null);
  const started = useRef<string | null>(null);
  const review = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [walletStep, setWalletStep] = useState<"approval" | "payment">();
  useEffect(() => () => operation.current?.abort(), []);
  const correct =
    connection.chainId === 11155111 &&
    connection.address?.toLowerCase() === plan.wallet.toLowerCase();
  const canOperate = enabled && !busy && correct && !!rpc && !!wallet;
  const actionLabel =
    plan.action.kind === "entry"
      ? `${classes[plan.action.classId].name} adventure`
      : [
          "Weapon",
          "Armor",
          "Tonic",
          "Ether",
          "First class spell",
          "Second class spell",
          "Vesper encounter",
          "Fairy encounter",
          "Healing and curse removal",
        ][paymentItem(plan.action.intent)!];
  async function register(hash: Hash, saved: PaymentPlan) {
    setWalletStep(undefined);
    setSubmitted(true);
    setMessage("Payment confirmed. Preparing your adventure…");
    return registerWhenReady(
      () => record(hash, saved),
      () =>
        setMessage(
          "1 GLOW payment confirmed. Waiting for the encounter draw… This normally takes about one minute after payment. Your adventure will open automatically; no further payment is needed.",
        ),
      operation.current!.signal,
    );
  }
  async function record(hash: Hash, saved: PaymentPlan) {
    if (saved.action.kind === "entry") {
      const result = await api<{ id: string }>("/api/rounds", {
        hash,
        classId: saved.action.classId,
      });
      return { roundId: result.id };
    }
    await api(`/api/rounds/${saved.action.roundId}/actions`, {
      version: saved.action.version,
      requestId: saved.action.requestId,
      intent: saved.action.intent,
      paymentHash: hash,
    });
    return { roundId: saved.action.roundId };
  }
  async function operate(mode: "pay" | "recover" | "expire") {
    if (!enabled || operation.current || !rpc || !wallet || !correct) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFailed(false);
    setResumable(false);
    setWalletStep(undefined);
    setMessage(
      mode === "pay" ? "Opening MetaMask…" : "Checking your saved payment…",
    );
    try {
      if (!navigator.locks)
        throw new Error(
          "This browser cannot safely coordinate payments across tabs.",
        );
      await navigator.locks.request(
        `lantern-payment:${plan.wallet.toLowerCase()}:${plan.contract.toLowerCase()}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error("Another tab is handling this payment.");
          const storage = localStorage;
          if (mode === "expire") {
            await api("/api/payments/expire", { paymentId: plan.paymentId });
            const saved = readPayment(
              storage,
              plan.wallet as Address,
              plan.contract as Address,
            );
            savePayment(storage, {
              ...(saved?.plan.paymentId === plan.paymentId
                ? saved
                : { version: 1 as const, plan }),
              stage: "expired",
            });
            onExpired();
            return;
          }
          let result: { roundId: string };
          if (mode === "recover") {
            const saved = readPayment(
              storage,
              plan.wallet as Address,
              plan.contract as Address,
            );
            const record =
              saved?.plan.paymentId === plan.paymentId
                ? saved
                : { version: 1 as const, plan, stage: "submitting" as const };
            result = await recoverPayment(
              record,
              { storage, register },
              async () => {
                const found = await api<{
                  hash?: Hash;
                  nextBlock: string | null;
                }>("/api/payments/recover", {
                  paymentId: plan.paymentId,
                  ...(nextBlock ? { fromBlock: nextBlock } : {}),
                });
                setNextBlock(found.nextBlock ?? undefined);
                if (!found.hash)
                  throw new Error(
                    found.nextBlock
                      ? "No match in this block range. Select Recover payment to check the next range."
                      : "No confirmed match yet. Check MetaMask Activity and retry recovery.",
                  );
                return found.hash;
              },
            );
          } else {
            if (
              !fresh &&
              !readPayment(
                storage,
                plan.wallet as Address,
                plan.contract as Address,
              )
            )
              throw new Error(
                "Recover this saved review before requesting another transaction.",
              );
            result = await executePayment(plan, {
              rpc,
              storage,
              register,
              send: tx.send,
              onProgress: setMessage,
              onWalletStep: setWalletStep,
              assertWallet: async () => {
                const accounts = await wallet.getAddresses();
                if (
                  (await wallet.getChainId()) !== 11155111 ||
                  !accounts[0] ||
                  !isAddressEqual(accounts[0], plan.wallet as Address)
                )
                  throw new Error(
                    "Your wallet changed. Reconnect the reviewed wallet.",
                  );
              },
            });
          }
          if (!controller.signal.aborted) onRecorded(result.roundId);
        },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      try {
        const saved = readPayment(
          localStorage,
          plan.wallet as Address,
          plan.contract as Address,
        );
        setResumable(canResumePayment(saved, plan));
        if (
          saved?.plan.paymentId === plan.paymentId &&
          (saved.hash || ["submitting", "submitted"].includes(saved.stage))
        )
          setSubmitted(true);
      } catch {
        // Preserve the original error if the browser also lost journal access.
      }
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Payment recovery is unavailable.",
      );
    } finally {
      operation.current = null;
      setBusy(false);
    }
  }
  function startOrResume(automatic = false) {
    try {
      const saved = readPayment(
        localStorage,
        plan.wallet as Address,
        plan.contract as Address,
      );
      void operate(
        (fresh || (!automatic && canResumePayment(saved, plan))) &&
          !(
            saved?.plan.paymentId === plan.paymentId &&
            (saved.hash || ["submitting", "submitted"].includes(saved.stage))
          )
          ? "pay"
          : "recover",
      );
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Payment recovery storage is unavailable.",
      );
    }
  }
  const startAutomatically = useEffectEvent(() => startOrResume(true));
  useEffect(() => {
    if (!autoStart || !canOperate || started.current === plan.paymentId) return;
    // Let Strict Mode's mount probe finish before asking the external wallet.
    const timer = setTimeout(() => {
      started.current = plan.paymentId;
      startAutomatically();
    }, 0);
    return () => clearTimeout(timer);
  }, [autoStart, canOperate, plan.paymentId]);
  useEffect(() => {
    if (autoStart) review.current?.focus({ preventScroll: true });
  }, [autoStart]);
  if (autoStart)
    return (
      <section
        ref={review}
        tabIndex={-1}
        className="glow-payment"
        role="dialog"
        aria-label="GLOW payment"
      >
        <h2>{actionLabel} · 1 GLOW</h2>
        {busy && walletStep === "approval" && (
          <p>
            Allow the game to use 1 GLOW. This approval does not transfer GLOW.
            The payment confirmation follows.
          </p>
        )}
        {busy && walletStep === "payment" && (
          <p>
            Confirm the 1 GLOW payment. After confirmation, keep this game open
            while it prepares your adventure.
          </p>
        )}
        <p role="status">
          {busy && tx.busy ? tx.status : message || "Preparing your payment…"}
        </p>
        {!correct && <p>Reconnect the paying wallet on Sepolia to continue.</p>}
        {correct && !wallet && (
          <p role="status">Waiting for your wallet connection…</p>
        )}
        {failed && (
          <div className="actions">
            <button disabled={!canOperate} onClick={() => startOrResume()}>
              {resumable
                ? "Continue in MetaMask"
                : submitted || !fresh
                  ? "Continue adventure"
                  : "Retry in MetaMask"}
            </button>
          </div>
        )}
        <details>
          <summary>Payment details and recovery</summary>
          <p>
            Sepolia test tokens only. The first payment may need two MetaMask
            confirmations: a 1 GLOW allowance, then entry. Confirmed payments
            are recovered without charging again.
          </p>
          <p className="address">Game: {plan.contract}</p>
          <p className="address">Token: {plan.token}</p>
          <p className="address">Wallet: {plan.wallet}</p>
          <button
            disabled={!canOperate}
            onClick={() => void operate("recover")}
          >
            Recover saved payment
          </button>
          <button
            className="text-button"
            disabled={!canOperate}
            onClick={() => void operate("expire")}
          >
            Release expired unpaid review
          </button>
        </details>
      </section>
    );
  return (
    <section className="panel section" aria-label="GLOW payment review">
      <h2>Review payment</h2>
      <p>
        {actionLabel} · <strong>1 GLOW</strong>
      </p>
      <p>
        Ethereum Sepolia. Network fees use test ETH. Winning returns every GLOW
        used in this adventure; defeat forfeits that spending.
      </p>
      {(plan.action.kind === "entry" ||
        ["dancer", "fairy"].includes(plan.action.intent.type)) && (
        <p className="small-note">
          The encounter draw becomes available about one minute after payment.
          If it is still pending, use Recover payment to continue without paying
          again.
        </p>
      )}
      <details>
        <summary>Wallet and contract details</summary>
        <p className="address">
          Wallet: {plan.wallet}
          <br />
          Token: {plan.token}
          <br />
          Spender: {plan.contract}
        </p>
        <p>
          Review expires: {new Date(Number(plan.deadline) * 1000).toISOString()}
        </p>
      </details>
      {!correct && <p role="status">Connect the reviewed wallet on Sepolia.</p>}
      {correct && !wallet && (
        <p role="status">Waiting for your wallet connection…</p>
      )}
      <div className="actions">
        <button
          type="button"
          disabled={!canOperate}
          onClick={() => void operate("pay")}
        >
          Review 1 GLOW in MetaMask
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!canOperate}
          onClick={() => void operate("recover")}
        >
          Recover payment
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!canOperate}
          onClick={() => void operate("expire")}
        >
          Release expired unpaid review
        </button>
      </div>
      <p className="small-note">
        If confirmation is interrupted, recover the saved payment. An unpaid
        review can be released after its onchain deadline. Approval alone does
        not start the adventure.
      </p>
      <TransactionStatus {...tx} />
      <p role="status">{message !== tx.status ? message : ""}</p>
    </section>
  );
}
