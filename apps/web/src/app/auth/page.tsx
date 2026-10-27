import { redirect } from "next/navigation";
import Image from "next/image";
import { Ornament, RpgIcon } from "@/components/rpg-icon";
import { AuthForm } from "@/features/auth/auth-form";
import { currentUser } from "@/server/current-user";
export const metadata = { title: "Account" };
export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string }>;
}) {
  const [user, params] = await Promise.all([currentUser(), searchParams]);
  if (user) redirect("/settings");
  const mode =
    params.mode === "register"
      ? "register"
      : params.mode === "reset"
        ? "reset"
        : "login";
  return (
    <div className="account-layout">
      <aside className="account-art" aria-hidden="true">
        <Image
          src="/art/lantern-vale-forest-v2.png"
          alt=""
          fill
          sizes="(max-width: 760px) 0px, 420px"
          quality={75}
        />
        <div>
          <RpgIcon name="lantern" />
          <span>Lantern Vale</span>
          <Ornament />
        </div>
      </aside>
      <section className="account-page">
        <h1>
          {mode === "register"
            ? "Create account"
            : mode === "reset"
              ? "Reset password"
              : "Sign in"}
        </h1>
        {params.error === "expired-link" && (
          <p role="alert" className="error">
            This account link has expired or is invalid. Please sign in again.
          </p>
        )}
        {["sign-in-cancelled", "sign-in-failed"].includes(
          params.error || "",
        ) && (
          <p role="alert" className="error">
            {params.error === "sign-in-cancelled"
              ? "Sign-in was cancelled. Please try again."
              : "Sign-in could not be completed. Please try again."}
          </p>
        )}
        <AuthForm key={mode} initialMode={mode} />
      </section>
    </div>
  );
}
