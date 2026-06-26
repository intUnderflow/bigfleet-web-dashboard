import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

// Honour the build-time base path (vite.config.ts) so the router resolves
// routes under the reverse-proxy prefix; "/" for a standalone build. React
// Router wants a leading but no trailing slash, except root.
const basename = import.meta.env.BASE_URL.replace(/\/+$/, "") || "/";

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
