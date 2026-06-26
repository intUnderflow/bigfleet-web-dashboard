import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AvailableCapacity from "./AvailableCapacity";

function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] ?? "";
    const body = routes[path];
    if (body === undefined) {
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "no route" }) } as Response;
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

afterEach(() => vi.restoreAllMocks());

describe("Available capacity view", () => {
  it("shows the unwired notice when no kubeconfig", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: false, kubeconfigWired: false },
      }),
    );
    renderWithProviders(<AvailableCapacity />);
    expect(await screen.findByText(/--kubeconfig/)).toBeInTheDocument();
  });

  it("renders per-cluster AvailableCapacity hints", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: false, kubeconfigWired: true },
        "/api/available-capacity": {
          clusters: [
            {
              id: "cluster-eu",
              items: [
                {
                  name: "a3-spot",
                  resources: { "nvidia.com/gpu": "8" },
                  availableCount: 12,
                  availability: "High",
                  cost: "6.50",
                },
              ],
            },
          ],
          queriedAt: "",
        },
      }),
    );
    renderWithProviders(<AvailableCapacity />);
    expect(await screen.findByText("cluster-eu")).toBeInTheDocument();
    expect(await screen.findByText("a3-spot")).toBeInTheDocument();
    expect(await screen.findByText("High")).toBeInTheDocument();
    expect(await screen.findByText("12")).toBeInTheDocument();
  });
});
