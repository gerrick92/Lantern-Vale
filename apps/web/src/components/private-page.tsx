import Link from "next/link";
import { requireUser } from "@/server/auth";
import { ApiError } from "@/server/http";
import { MfaPanel } from "@/features/auth/mfa-panel";
import { PixelCharacter } from "./pixel-character";
export async function PrivatePage({ children }: { children: React.ReactNode }) {
  try {
    await requireUser();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 403)
      return (
        <section
          className="account-checkpoint"
          aria-label="Account security checkpoint"
        >
          <div className="security-intro">
            <PixelCharacter index={5} />
            <div>
              <h2>Secure your account</h2>
              <p className="muted">
                You are signed in.
                {error.message.includes("two-factor")
                  ? " Complete authenticator setup to continue."
                  : " " + error.message}
              </p>
            </div>
          </div>
          {error.message.includes("two-factor") && <MfaPanel />}
        </section>
      );
    if (error.status === 401)
      return (
        <section className="panel">
          <h2>Your account</h2>
          <p>Sign in to continue.</p>
          <div className="actions account-actions">
            <Link className="button" href="/auth">
              Sign in
            </Link>
            <Link className="button" href="/auth?mode=register">
              Create account
            </Link>
          </div>
        </section>
      );
    if (error.status === 503)
      return (
        <section className="panel">
          <h2>Account service unavailable</h2>
          <p>Please try again shortly.</p>
          <Link href="/">Return to Lantern Vale</Link>
        </section>
      );
    throw error;
  }
  return children;
}
