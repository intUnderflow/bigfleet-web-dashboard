import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ShardReports from "./ShardReports";

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

describe("Shard reports drilldown", () => {
  it("shows the unwired notice when the coordinator is not wired", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: false, kubeconfigWired: false },
      }),
    );
    renderWithProviders(<ShardReports />);
    expect(await screen.findByText(/--coordinator-addr/)).toBeInTheDocument();
  });

  it("renders a shard's zone breakdown and its shortfall", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: true, kubeconfigWired: false },
        "/api/shard-reports": {
          reports: [
            {
              shardId: "shard-a",
              cycle: 88,
              receivedAtUnixNs: Date.now() * 1e6,
              summary: {
                totalMachines: 100,
                freeMachines: 20,
                instanceTypeCounts: { "m5.large": 60 },
                zoneCounts: { "zone-x": 50 },
              },
              shortfalls: [{ priority: 1000, deficit: { cpu: "8" }, ageCycles: 3, penaltyBucket: "PENALTY_BUCKET_8192" }],
            },
          ],
          queriedAt: "",
        },
      }),
    );
    renderWithProviders(<ShardReports />);
    expect(await screen.findByText("shard-a")).toBeInTheDocument();
    expect(await screen.findByText("zone-x")).toBeInTheDocument(); // the new per-zone breakdown
    expect(await screen.findByText("8192")).toBeInTheDocument(); // penalty bucket, prefix stripped
    expect(await screen.findByText("cpu=8")).toBeInTheDocument(); // shortfall deficit
  });
});
