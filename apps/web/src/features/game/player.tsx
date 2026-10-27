"use client";
import { paidEconomyReady } from "@/lib/economy-release";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, usePublicClient } from "wagmi";
import { z } from "zod";
import { ActionControls } from "./action-controls";
import { AdventureStatus } from "./adventure-status";
import { PaymentReview } from "./payment-review";
import { paymentPlanSchema, type PaymentPlan } from "./payment-journal";
import { api } from "@/lib/api";
import { CHAIN_ID } from "@/lib/chain";
import { verifySettlementClaim } from "./settlement-claim";
import {
  intentSchema,
  paymentItem,
  type Intent,
  type GameState,
} from "@game/rules";
import { usePreferences } from "@/features/settings/preferences";
import {
  useTransaction,
  TransactionStatus,
} from "@/features/wallet/transactions";
type Snapshot = {
  id: string;
  wallet: string;
  state: GameState;
  version: number;
  contract: `0x${string}`;
  contractRoundId: string;
};
const bridgeSchema = z
  .object({
    type: z.literal("mosslight.intent"),
    roundId: z.string(),
    nonce: z.string(),
    requestId: z.uuid(),
    intent: intentSchema,
  })
  .strict();
export function GamePlayer({
  roundId,
  enabled = paidEconomyReady,
  onPaymentOpen,
}: {
  roundId: string;
  enabled?: boolean;
  onPaymentOpen?(): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const nonce = useRef("");
  const inFlight = useRef(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<PaymentPlan>();
  const [freshPayment, setFreshPayment] = useState(false);
  const [paused, setPaused] = useState(false);
  const connection = useConnection();
  const rpc = usePublicClient({ chainId: CHAIN_ID });
  const client = useQueryClient();
  const tx = useTransaction();
  const [prefs] = usePreferences();
  useEffect(() => {
    if (payment) onPaymentOpen?.();
  }, [payment, onPaymentOpen]);
  useEffect(() => {
    if (payment?.action.kind !== "purchase") return;
    const requestId = payment.action.requestId;
    const keepWaiting = () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: "mosslight.payment-pending",
          nonce: nonce.current,
          roundId,
          requestId,
        },
        location.origin,
      );
    keepWaiting();
    const timer = setInterval(keepWaiting, 15000);
    return () => clearInterval(timer);
  }, [payment, roundId]);
  const query = useQuery({
    queryKey: ["round", roundId],
    queryFn: () => api<Snapshot>(`/api/rounds/${roundId}`),
    refetchOnWindowFocus: true,
  });
  const snapshot = query.data;
  const s = snapshot?.state;
  const correctWallet =
    !!connection.address &&
    connection.chainId === CHAIN_ID &&
    connection.address.toLowerCase() === snapshot?.wallet.toLowerCase();
  const sendState = useCallback(() => {
    if (!nonce.current) nonce.current = crypto.randomUUID();
    frame.current?.contentWindow?.postMessage(
      {
        type: "mosslight.state",
        nonce: nonce.current,
        roundId,
        snapshot,
        paused: paused || !correctWallet || !!payment,
        mute: prefs.mute,
        reduced:
          prefs.reduced ||
          prefs.accessible ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      window.location.origin,
    );
  }, [snapshot, roundId, paused, correctWallet, prefs, payment]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void api<{ plan: unknown }>("/api/payments/pending")
      .then((result) => {
        if (!cancelled && result.plan) {
          const plan = paymentPlanSchema.parse(result.plan);
          if (
            plan.action.kind === "purchase" &&
            plan.action.roundId === roundId
          ) {
            setPayment(plan);
            setFreshPayment(false);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [roundId, enabled]);
  const replyToAction = useCallback(
    (requestId: string, result?: Snapshot, error?: string) => {
      frame.current?.contentWindow?.postMessage(
        {
          type: "mosslight.action-result",
          nonce: nonce.current,
          roundId,
          requestId,
          accepted: !!result,
          snapshot: result,
          error,
        },
        window.location.origin,
      );
    },
    [roundId],
  );
  const act = useCallback(
    async (intent: Intent, requestId = crypto.randomUUID()) => {
      if (
        !snapshot ||
        inFlight.current ||
        paused ||
        !correctWallet ||
        payment
      ) {
        replyToAction(
          requestId,
          undefined,
          "The adventure is paused or another action is still pending.",
        );
        return;
      }
      inFlight.current = true;
      setBusy(true);
      try {
        if (paymentItem(intent) !== undefined) {
          const plan = paymentPlanSchema.parse(
            await api("/api/payments/review", {
              kind: "purchase",
              roundId,
              version: snapshot.version,
              requestId,
              intent,
            }),
          );
          setPayment(plan);
          setFreshPayment(true);
          setMessage("");
          return;
        }
        const result = await api<{ state: GameState; version: number }>(
          `/api/rounds/${roundId}/actions`,
          { version: snapshot.version, requestId, intent },
        );
        const updated = { ...snapshot, ...result };
        client.setQueryData(["round", roundId], updated);
        replyToAction(requestId, updated);
        setMessage("");
      } catch (e) {
        setMessage((e as Error).message);
        replyToAction(requestId, undefined, (e as Error).message);
        await client.invalidateQueries({ queryKey: ["round", roundId] });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [snapshot, roundId, client, paused, correctWallet, replyToAction, payment],
  );
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "mosslight.ready") {
        sendState();
        return;
      }
      const parsed = bridgeSchema.safeParse(event.data);
      if (
        parsed.success &&
        parsed.data.nonce === nonce.current &&
        parsed.data.roundId === roundId
      )
        void act(parsed.data.intent, parsed.data.requestId);
    }
    window.addEventListener("message", receive);
    sendState();
    return () => window.removeEventListener("message", receive);
  }, [sendState, act, roundId]);
  async function claim() {
    try {
      if (!enabled || !snapshot || !rpc || !correctWallet)
        throw new Error("Connect the paying wallet before settlement.");
      const result = await api(`/api/rounds/${roundId}/claim`, {});
      const call = await verifySettlementClaim(
        result,
        {
          contract: snapshot.contract,
          wallet: snapshot.wallet as `0x${string}`,
          roundId: snapshot.contractRoundId,
          spent: snapshot.state.spent,
          won: snapshot.state.phase === "victory",
        },
        rpc,
      );
      await tx.send(call);
      setMessage("Settlement confirmed on Sepolia.");
      await client.invalidateQueries();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <>
      <div className="actions glow-companion-controls">
        <button
          type="button"
          className="secondary"
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => void query.refetch()}
        >
          Refresh saved state
        </button>
        <a href="#paid-companion">Skip to accessible companion</a>
      </div>
      <div className="game-layout">
        <div className="glow-stage">
          <iframe
            inert={!!payment}
            className="practice-frame"
            ref={frame}
            src="/games/mosslight/index.html"
            title="Lantern Vale RPG Maker MZ game"
            allow="fullscreen"
            onLoad={sendState}
          />
          {payment && (
            <div className="glow-overlay">
              <PaymentReview
                key={payment.paymentId}
                autoStart
                enabled={enabled}
                plan={payment}
                fresh={freshPayment}
                onRecorded={() => {
                  const requestId =
                    payment.action.kind === "purchase"
                      ? payment.action.requestId
                      : undefined;
                  setPayment(undefined);
                  void query.refetch().then(({ data }) => {
                    if (data && requestId) replyToAction(requestId, data);
                  });
                }}
                onExpired={() => {
                  if (payment.action.kind === "purchase")
                    replyToAction(
                      payment.action.requestId,
                      undefined,
                      "The unpaid review expired. No GLOW was used.",
                    );
                  setPayment(undefined);
                  void query.refetch();
                }}
              />
            </div>
          )}
        </div>
        <section
          id="paid-companion"
          tabIndex={-1}
          className="panel section"
          aria-label="Paid adventure companion"
        >
          <h2>Adventure companion</h2>
          {query.isPending && <p>Loading your saved adventure…</p>}
          {query.error && <p role="alert">{query.error.message}</p>}
          {s && (
            <>
              <AdventureStatus state={s} />
              <label htmlFor="hero-hp">
                Health: {s.hp} / {s.maxHp}
              </label>
              <progress id="hero-hp" value={s.hp} max={s.maxHp} />
              <p>
                Mana {s.mp}/{s.maxMp} · Used {s.spent} GLOW · Potions{" "}
                {s.potions}
              </p>
              <p>
                {s.weapon
                  ? "Trail-forged weapon equipped."
                  : "Starting weapon."}{" "}
                {s.armor ? "Barkweave armor equipped." : "Starting armor."}
              </p>
              {!correctWallet && (
                <p className="status">
                  Connect the wallet that paid for this round on Sepolia to
                  continue.
                </p>
              )}
              <ActionControls
                state={s}
                disabled={busy || paused || !correctWallet || !!payment}
                onAction={act}
              />
              <ol className="quest-log" aria-label="Adventure events">
                {s.log.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ol>
              {["victory", "defeat"].includes(s.phase) && (
                <>
                  <p>
                    {s.phase === "victory"
                      ? "Victory saved. Confirm settlement to return your deposits and receive any available bonus."
                      : "Defeat saved. Settlement recycles only the GLOW already used in this adventure."}
                  </p>
                  <button
                    type="button"
                    disabled={!enabled || tx.busy || !correctWallet}
                    onClick={() => void claim()}
                  >
                    Settle saved result
                  </button>
                  <TransactionStatus {...tx} />
                </>
              )}
            </>
          )}
          <p role="status">{message}</p>
        </section>
      </div>
      <p className="muted glow-companion-note">
        The companion provides the same server-validated town and combat actions
        as the game, including text navigation between maps. The visual map is
        rendered on canvas. Pause stops your inputs; no timed combat continues
        in the background.
      </p>
    </>
  );
}
