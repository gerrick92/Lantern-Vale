import type { Metadata } from "next";
import localFont from "next/font/local";
import { currentUser } from "@/server/current-user";
import { Providers } from "@/components/providers";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";
const cinzel = localFont({
  src: "../../public/fonts/cinzel-variable.ttf",
  variable: "--font-display",
  display: "swap",
  weight: "400 900",
});
export const metadata: Metadata = {
  title: { default: "Lantern Vale", template: "%s · Lantern Vale" },
  description:
    "A classic fantasy RPG with six classes and GLOW test tokens on Ethereum Sepolia.",
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  return (
    <html lang="en" className={cinzel.variable}>
      <body>
        <Providers>
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <SiteShell userId={user?.id ?? null}>{children}</SiteShell>
        </Providers>
      </body>
    </html>
  );
}
