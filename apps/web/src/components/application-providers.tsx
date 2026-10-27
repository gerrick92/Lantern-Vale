"use client";
import { useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { browserAuth } from "@/lib/browser-auth";
import { authConfigured } from "@/lib/auth-config";
export default function ApplicationProviders({
  children,
}: {
  children: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
      }),
  );
  useEffect(() => {
    if (!authConfigured) return;
    let currentUser: string | null | undefined;
    const { data } = browserAuth().auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id ?? null;
      if (currentUser && nextUser !== currentUser) {
        client.clear();
        // Drop private component state as well as cached server responses.
        window.location.replace("/auth");
      }
      currentUser = nextUser;
    });
    return () => data.subscription.unsubscribe();
  }, [client]);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
