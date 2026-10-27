import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountData } from "../../../apps/web/src/features/settings/account-data";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <main>
      <h1>Settings</h1>
      <AccountData />
    </main>
  </QueryClientProvider>,
);
