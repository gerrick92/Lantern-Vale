"use client";
import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AccountDataStatus } from "@/lib/account-data";

export function AccountData() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["account-data-status"],
    queryFn: () => api<AccountDataStatus>("/api/account/deletion"),
  });
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const cancelFocus = useRef<HTMLButtonElement>(null);
  const confirmFocus = useRef<HTMLInputElement>(null);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Account request failed. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function download() {
    await run(async () => {
      const data = await api<unknown>("/api/account/data");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "lantern-vale-account.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Your account data download is ready.");
    });
  }
  async function change(requested: boolean) {
    await run(async () => {
      const data = await api<AccountDataStatus>(
        "/api/account/deletion",
        requested ? { action: "request", confirmation } : { action: "cancel" },
      );
      client.setQueryData(["account-data-status"], data);
      setConfirmation("");
      setMessage(
        requested
          ? "Deletion requested. Your account remains active while the request is reviewed."
          : "Deletion request cancelled.",
      );
      requestAnimationFrame(() =>
        (requested ? cancelFocus.current : confirmFocus.current)?.focus(),
      );
    });
  }
  const ready = status.data?.available === true;
  return (
    <section className="panel" aria-label="Account data">
      <h2>Account data</h2>
      <details>
        <summary>Download data or request deletion</summary>
        {status.isPending && <p role="status">Loading account data options…</p>}
        {status.isError && (
          <>
            <p role="alert">Account data options could not be loaded.</p>
            <button
              type="button"
              className="secondary"
              disabled={status.isFetching}
              onClick={() => void status.refetch()}
            >
              Retry account data options
            </button>
          </>
        )}
        {status.data && !ready && (
          <p>Account data tools are awaiting a service update.</p>
        )}
        <h3>Download your data</h3>
        <p>
          Your profile, contacts, linked wallet and saved adventure history.
          Keep the downloaded file private.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={!ready || busy}
          onClick={() => void download()}
        >
          Download account data
        </button>
        <h3 className="section">Request account deletion</h3>
        <p>
          Requests are reviewed before anything is deleted. Open payments and
          adventure records need settlement review first. Public blockchain
          records and payment replay protection are retained.
        </p>
        {status.data?.needsPaymentReview && (
          <p className="small-note">
            Your payment or adventure records require review. Winning or losing
            alone does not confirm settlement.
          </p>
        )}
        {status.data?.requestedAt ? (
          <>
            <p>
              Deletion request awaiting review. You can still use your account
              or cancel this request.
            </p>
            <button
              ref={cancelFocus}
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void change(false)}
            >
              Cancel deletion request
            </button>
          </>
        ) : (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void change(true);
            }}
          >
            <label htmlFor="account-deletion-confirmation">
              Type DELETE to request deletion
            </label>
            <input
              ref={confirmFocus}
              id="account-deletion-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              pattern="DELETE"
              disabled={!ready || busy}
              required
            />
            <div className="actions">
              <button
                type="submit"
                className="secondary"
                disabled={!ready || busy || confirmation !== "DELETE"}
              >
                Request deletion
              </button>
            </div>
          </form>
        )}
        {busy && <p role="status">Working…</p>}
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "error" : undefined}
        >
          {message}
        </p>
      </details>
    </section>
  );
}
