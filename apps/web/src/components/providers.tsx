"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeSync } from "@/features/settings/preferences";
const ApplicationProviders = dynamic(() => import("./application-providers"));
export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const lightweightPage = [
    "/",
    "/features",
    "/dev/play",
    "/adventure/test",
  ].includes(pathname);
  return (
    <>
      <ThemeSync />
      {lightweightPage ? (
        children
      ) : (
        <ApplicationProviders>{children}</ApplicationProviders>
      )}
    </>
  );
}
