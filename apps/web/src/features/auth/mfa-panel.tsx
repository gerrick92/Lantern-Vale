"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { browserAuth } from "@/lib/browser-auth";
import { authConfigured } from "@/lib/auth-config";
import { authenticatorEnrollmentUri } from "@/lib/auth-qr";
import { SignOutSection } from "./sign-out-section";
type Stage = "loading" | "new" | "enroll" | "challenge" | "verified";
export function MfaPanel({ showLogout = true }: { showLogout?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const inputId = useId();
  const [stage, setStage] = useState<Stage>("loading");
  const [factor, setFactor] = useState("");
  const [enrollment, setEnrollment] = useState<{
    uri: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [remove, setRemove] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    if (!authConfigured) return;
    const client = browserAuth();
    void Promise.all([
      client.auth.mfa.listFactors(),
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
      .then(([factors, assurance]) => {
        if (!active) return;
        if (factors.error || assurance.error) {
          setStage("new");
          setFailed(true);
          setMessage("Could not load your authenticator. Try again.");
          return;
        }
        const verified = factors.data.totp.find((f) => f.status === "verified");
        setFactor(verified?.id || "");
        setStage(
          verified
            ? assurance.data.currentLevel === "aal2"
              ? "verified"
              : "challenge"
            : "new",
        );
      })
      .catch(() => {
        if (active) {
          setStage("new");
          setFailed(true);
          setMessage("Could not reach the account service.");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: "setup" | "verify" | "remove") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const client = browserAuth();
      if (action === "setup") {
        const factors = await client.auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        const existing = factors.data.totp.find((f) => f.status === "verified");
        if (existing) {
          setFactor(existing.id);
          setEnrollment(null);
          setStage("challenge");
          return;
        }
        if (enrollment && factors.data.all.some((f) => f.id === factor)) {
          setStage("enroll");
          return;
        }
        // Only replace this application's unfinished enrollment. Verified factors are never reset here.
        for (const unfinished of factors.data.all.filter(
          (f) =>
            f.factor_type === "totp" &&
            f.status === "unverified" &&
            ["Mosslight authenticator", "Lantern Vale authenticator"].includes(
              f.friendly_name || "",
            ),
        )) {
          const removed = await client.auth.mfa.unenroll({
            factorId: unfinished.id,
          });
          if (removed.error) throw removed.error;
        }
        const result = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Lantern Vale authenticator",
          issuer: "Lantern Vale",
        });
        if (result.error) throw result.error;
        const uri = authenticatorEnrollmentUri(
          result.data.totp.secret,
          result.data.totp.uri,
        );
        setFactor(result.data.id);
        setEnrollment({ uri, secret: result.data.totp.secret });
        setCode("");
        setStage("enroll");
        return;
      }
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const id =
        factor || factors.data.totp.find((f) => f.status === "verified")?.id;
      if (!id) throw new Error("Choose Set up authenticator first.");
      const verification = await client.auth.mfa.challengeAndVerify({
        factorId: id,
        code,
      });
      if (verification.error) {
        setCode("");
        throw new Error(
          "That code was not accepted. Use the latest six-digit code for Lantern Vale and check that your phone's time is automatic.",
        );
      }
      setEnrollment(null);
      setCode("");
      setShowKey(false);
      if (action === "remove") {
        const result = await client.auth.mfa.unenroll({ factorId: id });
        if (result.error) throw result.error;
        const logout = await client.auth.signOut({ scope: "global" });
        if (logout.error) throw logout.error;
        router.replace("/auth");
        router.refresh();
      } else {
        setStage("verified");
        setMessage("Authenticator verified.");
        if (pathname === "/auth") router.replace("/dashboard");
        router.refresh();
      }
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not complete authentication. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function copyKey() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setFailed(false);
      setMessage("Setup key copied. Paste it only into your authenticator.");
    } catch {
      setShowKey(true);
      setFailed(true);
      setMessage(
        "Copy is unavailable. Enter the displayed setup key manually.",
      );
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(remove ? "remove" : "verify");
  }
  return (
    <>
      <section className="panel mfa-panel" aria-label="Authenticator">
        <h2>
          {stage === "verified" ? "Authenticator connected" : "Authenticator"}
        </h2>
        {!authConfigured ? (
          <p>Account services are unavailable.</p>
        ) : (
          <>
            {stage === "loading" && (
              <p role="status">Checking your authenticator…</p>
            )}
            {stage === "new" && (
              <>
                <p>Add Lantern Vale to an authenticator app on your phone.</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run("setup")}
                >
                  {busy ? "Preparing…" : "Set up authenticator"}
                </button>
              </>
            )}
            {stage === "enroll" && enrollment && (
              <>
                <div className="mfa-enrollment">
                  <div className="mfa-qr">
                    <QRCodeSVG
                      value={enrollment.uri}
                      size={232}
                      marginSize={4}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      title="Scan this private authenticator enrollment QR code"
                      role="img"
                    />
                  </div>
                  <ol className="mfa-steps">
                    <li>
                      Open Google Authenticator, Microsoft Authenticator or your
                      existing authenticator app.
                    </li>
                    <li>
                      Choose <strong>Add account → Scan QR code</strong>. In
                      Microsoft Authenticator, choose{" "}
                      <strong>Other account</strong>.
                    </li>
                    <li>
                      Scan this square, then enter the six-digit code below.
                    </li>
                  </ol>
                </div>
                <details className="disclosure">
                  <summary>Cannot scan? Use a setup key</summary>
                  <p>
                    Choose “Enter a setup key” in your authenticator. Account
                    name: <strong>Lantern Vale</strong>. Type:{" "}
                    <strong>Time based</strong>.
                  </p>
                  <label htmlFor={inputId + "-secret"}>Private setup key</label>
                  <input
                    id={inputId + "-secret"}
                    className="setup-key"
                    type={showKey ? "text" : "password"}
                    readOnly
                    value={enrollment.secret}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? "Hide key" : "Show key"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void copyKey()}
                    >
                      Copy key
                    </button>
                  </div>
                  <p className="small-note">
                    Keep this key private. Do not send it in chat or
                    screenshots.
                  </p>
                </details>
              </>
            )}
            {stage === "challenge" && (
              <p>
                Enter the code from your existing Lantern Vale authenticator.
              </p>
            )}
            {(stage === "enroll" || stage === "challenge" || remove) && (
              <form onSubmit={submit}>
                <label htmlFor={inputId}>Six-digit code</label>
                <input
                  className="totp-input"
                  id={inputId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  required
                />
                <div className="actions">
                  <button type="submit" disabled={busy || code.length !== 6}>
                    {busy
                      ? "Verifying…"
                      : remove
                        ? "Remove and sign out"
                        : "Verify and continue"}
                  </button>
                </div>
              </form>
            )}
            {stage === "challenge" && (
              <details className="disclosure">
                <summary>Cannot access your authenticator?</summary>
                <p>
                  Use its recovery backup. Resetting your password does not
                  remove an existing authenticator. Account recovery needs a
                  separate ownership check.
                </p>
              </details>
            )}
            {stage === "verified" && (
              <details className="disclosure">
                <summary>Remove authenticator</summary>
                <p>
                  This signs you out of all sessions. Private features require a
                  new authenticator setup afterward.
                </p>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setRemove(!remove)}
                >
                  {remove ? "Cancel removal" : "Continue with removal"}
                </button>
              </details>
            )}
            <p role="status" className={failed ? "error" : "muted"}>
              {message}
            </p>
          </>
        )}
      </section>
      {showLogout && authConfigured && <SignOutSection />}
    </>
  );
}
