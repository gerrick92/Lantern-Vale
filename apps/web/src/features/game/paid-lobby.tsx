"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection } from "wagmi";
import { classSchema } from "@game/rules";
import { paidEconomyReady, economyReleaseMessage } from "@/lib/economy-release";
import { api } from "@/lib/api";
import { usePreferences } from "@/features/settings/preferences";
import {
  WalletOwnership,
  useWalletOwnership,
} from "@/features/wallet/ownership";
import { paymentPlanSchema, type PaymentPlan } from "./payment-journal";
import { PaymentReview } from "./payment-review";

export function PaidLobby({
  enabled = paidEconomyReady,
  onStarted,
}: {
  enabled?: boolean;
  onStarted?: (id: string) => void;
}) {
  const router = useRouter();
  const frame = useRef<HTMLIFrameElement>(null);
  const nonce = useRef("");
  const working = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const [prefs] = usePreferences();
  const connection = useConnection();
  const ownership = useWalletOwnership();
  const [plan, setPlan] = useState<PaymentPlan>();
  const [fresh, setFresh] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const send = useCallback(() => {
    if (!nonce.current) nonce.current = crypto.randomUUID();
    frame.current?.contentWindow?.postMessage(
      {
        type: "mosslight.entry-options",
        nonce: nonce.current,
        enabled: enabled && ownership.ready && !plan && !reviewing,
        mute: prefs.mute,
        reduced: prefs.reduced || prefs.accessible,
      },
      location.origin,
    );
  }, [plan, prefs, enabled, ownership.ready, reviewing]);
  useEffect(() => {
    if (!enabled || !ownership.ready) return;
    let cancelled = false;
    void api<{ plan: unknown }>("/api/payments/pending")
      .then((result) => {
        if (!cancelled && result.plan) {
          setPlan(paymentPlanSchema.parse(result.plan));
          setFresh(false);
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [connection.address, enabled, ownership.ready]);
  useEffect(() => {
    if (!plan && !message) return;
    feedback.current?.focus({ preventScroll: true });
  }, [plan, message]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (event.data?.type === "mosslight.ready") {
        send();
        return;
      }
      if (
        !enabled ||
        !ownership.ready ||
        plan ||
        working.current ||
        event.data?.type !== "mosslight.entry-class" ||
        event.data.nonce !== nonce.current
      )
        return;
      const chosen = classSchema.safeParse(event.data.classId);
      if (!chosen.success) return;
      working.current = true;
      setReviewing(true);
      setMessage("");
      void api("/api/payments/review", { kind: "entry", classId: chosen.data })
        .then((review) => {
          setPlan(paymentPlanSchema.parse(review));
          setFresh(true);
          setMessage("");
        })
        .catch((error) => setMessage(error.message))
        .finally(() => {
          working.current = false;
          setReviewing(false);
        });
    }
    addEventListener("message", receive);
    send();
    return () => removeEventListener("message", receive);
  }, [plan, send, enabled, ownership.ready]);
  if (!enabled) return <p role="status">{economyReleaseMessage}</p>;
  if (!ownership.ready)
    return (
      <section className="panel" aria-labelledby="entry-wallet-title">
        <h2 id="entry-wallet-title">Your adventure wallet</h2>
        <WalletOwnership allowUnlink={false} />
      </section>
    );
  return (
    <div className="glow-stage">
      <div
        ref={feedback}
        tabIndex={-1}
        className={plan || message || reviewing ? "glow-overlay" : undefined}
      >
        {message && (
          <section className="glow-payment">
            <p role="alert">{message}</p>
            {!plan && !reviewing && (
              <button
                onClick={() => {
                  setMessage("");
                  frame.current?.focus();
                }}
              >
                Choose again
              </button>
            )}
          </section>
        )}
        {reviewing && (
          <p className="glow-payment" role="status">
            Preparing your 1 GLOW entry…
          </p>
        )}
        {plan && (
          <PaymentReview
            key={plan.paymentId}
            autoStart
            enabled={enabled}
            plan={plan}
            fresh={fresh}
            onRecorded={(id) =>
              onStarted
                ? onStarted(id)
                : router.push(`/adventure/play?round=${id}`)
            }
            onExpired={() => setPlan(undefined)}
          />
        )}
      </div>
      <iframe
        inert={!!plan || reviewing}
        ref={frame}
        className="practice-frame"
        src="/games/mosslight/index.html"
        title="Choose your Lantern Vale class"
        onLoad={send}
      />
    </div>
  );
}
