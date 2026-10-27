import { PrivatePage } from "@/components/private-page";
import { Appearance } from "@/features/settings/appearance";
import { AccountSettings } from "@/features/settings/account-settings";
import { AccountData } from "@/features/settings/account-data";
import { MfaPanel } from "@/features/auth/mfa-panel";
import { AuthForm } from "@/features/auth/auth-form";
import { SignOutSection } from "@/features/auth/sign-out-section";
import Link from "next/link";
import { canAccessDeveloperTools } from "@/server/developer-access";
export const metadata = { title: "Settings" };
export default async function SettingsPage() {
  const developerTools = await canAccessDeveloperTools();
  return (
    <>
      <h1>Settings</h1>
      <div className="two-column">
        <Appearance developerTools={developerTools} />
        <PrivatePage>
          <div>
            <AccountSettings />
            <MfaPanel showLogout={false} />
            <section className="panel" aria-label="Password settings">
              <h2>Password</h2>
              <details>
                <summary>Change password</summary>
                <AuthForm initialMode="update" passwordOnly />
              </details>
            </section>
            <AccountData />
            <SignOutSection collapsible />
            {developerTools && (
              <section className="panel" aria-label="Developer tools">
                <h2>Developer tools</h2>
                <details>
                  <summary>Open developer tools</summary>
                  <p>
                    Only your verified account can open these tools on this
                    local development site.
                  </p>
                  <div className="actions">
                    <Link className="button" href="/dev/deploy">
                      Token and faucet deployment
                    </Link>
                    <Link className="button secondary" href="/dev/deploy/game">
                      Game contract review
                    </Link>
                    <Link className="button secondary" href="/dev/play">
                      Game demo controls
                    </Link>
                  </div>
                </details>
              </section>
            )}
          </div>
        </PrivatePage>
      </div>
    </>
  );
}
