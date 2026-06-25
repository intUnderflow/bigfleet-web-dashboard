import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Providers from "./Providers";

// routeFetch answers by request path, so a page that hits /api/config and
// /api/providers gets the right body for each.
function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = routes[path];
    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "no route" }),
      } as Response;
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
  });
}

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Providers page", () => {
  it("shows the unwired notice when the coordinator is not wired", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": {
          grafanaUrl: "",
          prometheusWired: false,
          coordinatorWired: false,
          kubeconfigWired: false,
        },
      }),
    );
    renderWithProviders(<Providers />);
    expect(await screen.findByText(/--coordinator-addr/)).toBeInTheDocument();
  });

  it("renders the registered providers when the coordinator is wired", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": {
          grafanaUrl: "",
          prometheusWired: false,
          coordinatorWired: true,
          kubeconfigWired: false,
        },
        "/api/providers": {
          providers: [{ name: "aws", address: "aws-provider:7800", region: "us-east-1" }],
          queriedAt: "",
        },
      }),
    );
    renderWithProviders(<Providers />);
    expect(await screen.findByText("aws")).toBeInTheDocument();
    expect(await screen.findByText("us-east-1")).toBeInTheDocument();
  });
});
