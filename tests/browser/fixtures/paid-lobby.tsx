import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GameSession } from "../../../apps/web/src/features/game/game-session";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <main>
        <h1>Lantern Vale</h1>
        <GameSession enabled />
      </main>
    </QueryClientProvider>
  </StrictMode>,
);
