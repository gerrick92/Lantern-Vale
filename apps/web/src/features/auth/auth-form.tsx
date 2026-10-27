"use client";
import { useRef, useState, type FormEvent } from "react";
import { browserAuth } from "@/lib/browser-auth";
import { authConfigured } from "@/lib/auth-config";
import Link from "next/link";
import { useRouter } from "next/navigation";
type Mode = "login" | "register" | "reset" | "update";
export function AuthForm({
  initialMode = "login",
  passwordOnly = false,
}: {
  initialMode?: Mode;
  passwordOnly?: boolean;
}) {
  const router = useRouter();
  const mode = initialMode;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || mode === "reset") return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    try {
      const client = browserAuth();
      if (mode === "register" && password !== fields.get("confirm"))
        throw new Error("Passwords do not match.");
      const result =
        mode === "login"
          ? await client.auth.signInWithPassword({ email, password })
          : mode === "register"
            ? await client.auth.signUp({
                email,
                password,
              })
            : await client.auth.updateUser({ password });
      if (result.error) throw result.error;
      if (
        mode === "register" &&
        !("session" in result.data && result.data.session)
      )
        throw new Error(
          "Registration could not finish. Please try signing in, or contact the project owner.",
        );
      if (mode === "login" || mode === "register") {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setMessage("Password updated.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to complete this request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (mode === "reset")
    return (
      <section className="panel">
        <p>Email password reset is unavailable in this demo.</p>
        <p>
          If you are still signed in on another device, change your password in
          Settings. Otherwise, account recovery is not available yet.
        </p>
        <Link className="button" href="/auth">
          Back to sign in
        </Link>
      </section>
    );
  return (
    <>
      <section className="panel">
        {!passwordOnly && (
          <div className="tabs" role="group" aria-label="Account action">
            {(
              [
                ["login", "Sign in"],
                ["register", "Create account"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                href={value === "register" ? "/auth?mode=register" : "/auth"}
                aria-current={mode === value ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
        {!authConfigured && (
          <p className="status">
            Account services are not configured yet. Please try again later.
          </p>
        )}
        <form onSubmit={submit} className="form-grid">
          {mode !== "update" && (
            <div>
              <label htmlFor="email">Email address</label>
              <input
                type="email"
                id="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </div>
          )}
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={12}
              maxLength={128}
              required
              aria-describedby="password-help"
            />
            <p id="password-help" className="muted">
              At least 12 characters.
            </p>
          </div>
          {mode === "register" && (
            <div>
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
            </div>
          )}
          {mode === "register" && (
            <p className="muted">
              Next, set up Google Authenticator. Save your password; email
              password reset is unavailable in this demo.
            </p>
          )}
          <button type="submit" disabled={!authConfigured || busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create account"
                  : "Update password"}
          </button>
        </form>
        {!passwordOnly && (
          <Link className="forgot-password" href="/auth?mode=reset">
            Forgot password?
          </Link>
        )}
        <p role="status" className="status">
          {message}
        </p>
      </section>
    </>
  );
}
