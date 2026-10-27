"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserAuth } from "@/lib/browser-auth";

export function SignOutSection({
  collapsible = false,
}: {
  collapsible?: boolean;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function signOut() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await browserAuth().auth.signOut({ scope: "global" });
      if (result.error) throw result.error;
      router.replace("/auth");
      router.refresh();
    } catch {
      setMessage("Could not sign out. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const controls = (
    <>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void signOut()}
      >
        {busy ? "Signing out…" : "Sign out all sessions"}
      </button>
      {message && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
    </>
  );
  return (
    <section className="panel" aria-label="Logout">
      <h2>Logout</h2>
      {collapsible ? (
        <details>
          <summary>Sign out</summary>
          {controls}
        </details>
      ) : (
        controls
      )}
    </section>
  );
}
