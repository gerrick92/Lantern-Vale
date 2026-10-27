"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { RpgIcon, type RpgIconName } from "./rpg-icon";
import { authConfigured } from "@/lib/auth-config";
import { browserAuth } from "@/lib/browser-auth";

export function SiteShell({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const active =
    pathname.startsWith("/dev/play") || pathname.startsWith("/adventure")
      ? "/adventure"
      : pathname;
  const links = userId
    ? [
        ["/", "Home"],
        ["/features", "Info"],
        ["/dashboard", "Dashboard"],
        ["/wallet", "Wallet"],
        ["/adventure", "Play"],
        ["/settings", "Settings"],
      ]
    : [
        ["/", "Home"],
        ["/features", "Info"],
        ["/settings", "Settings"],
      ];
  const icons: Record<string, RpgIconName> = {
    "/": "home",
    "/features": "book",
    "/dashboard": "shield",
    "/wallet": "coins",
    "/adventure": "sword",
    "/settings": "gear",
  };

  useEffect(() => {
    if (!authConfigured) return;
    let previous = userId;
    const { data } = browserAuth().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (next === previous) return;
      const hadAccount = previous !== null;
      previous = next;
      if (hadAccount) window.location.replace("/auth");
      else router.refresh();
    });
    return () => data.subscription.unsubscribe();
  }, [userId, router]);

  return (
    <div
      className={
        "site-shell" + (pathname === "/" ? " is-home" : " is-interior")
      }
    >
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand" aria-label="Lantern Vale home">
            <RpgIcon name="lantern" />
            <span>Lantern Vale</span>
          </Link>
          <nav className="site-nav" aria-label="Main navigation">
            {links.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={active === href ? "page" : undefined}
              >
                <RpgIcon name={icons[href]} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          {!userId && (
            <Link
              href="/auth"
              className="account-link"
              aria-current={pathname === "/auth" ? "page" : undefined}
            >
              <RpgIcon name="key" />
              <span>Sign in</span>
            </Link>
          )}
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={"site-main" + (pathname === "/" ? " home-main" : "")}
      >
        {children}
      </main>
      <footer className="site-footer">
        <span>© 2026 Lantern Vale</span>
      </footer>
    </div>
  );
}
