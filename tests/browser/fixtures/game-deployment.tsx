import { createRoot } from "react-dom/client";
import { GameDeploymentPanel } from "../../../apps/web/src/features/deployment/game-panel";
import type { SavedGameReview } from "../../../apps/web/src/features/deployment/game-plan";
import plan from "../../../deployments/game-economy-plan.json";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const config = createConfig({
  chains: [sepolia],
  transports: { [sepolia.id]: http("http://127.0.0.1:3199/rpc") },
});
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={client}>
      <main>
        <h1>Game contract review</h1>
        <GameDeploymentPanel plan={plan as SavedGameReview} />
      </main>
    </QueryClientProvider>
  </WagmiProvider>,
);
