import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SupplyLedger } from "../../../apps/web/src/features/wallet/supply-ledger";
import { Faucet } from "../../../apps/web/src/features/wallet/faucet";
import { TokenOverview } from "../../../apps/web/src/features/wallet/token-overview";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <main>
      <Faucet />
      <TokenOverview />
      <SupplyLedger />
    </main>
  </QueryClientProvider>,
);
