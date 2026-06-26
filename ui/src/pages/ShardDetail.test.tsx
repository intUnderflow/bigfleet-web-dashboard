import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ShardDetail from "./ShardDetail";

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

function renderShard(pod: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/shards/${pod}`]}>
        <Routes>
          <Route path="/shards/:pod" element={<ShardDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const wiredConfig = { grafanaUrl: "", prometheusWired: true, coordinatorWired: false, kubeconfigWired: false };

const shardDetail = {
  pod: "bigfleet-shard-0",
  cycleP99Seconds: 3.1,
  cycleP99ByPhaseSeconds: { assign: 1.2 },
  machines: 50,
  machinesByState: { Configured: 40, Idle: 10 },
  machinesByCapacityType: { Spot: 30, OnDemand: 20 },
  shortfalls: 0,
  activeSessions: 4,
  actionsByKindRatePerSec: { Bootstrap: 1.2 },
  occCommittedPerSec: 5,
  occConflictPerSec: 0.5,
  queriedAt: "",
};

afterEach(() => vi.restoreAllMocks());

describe("Shard detail view", () => {
  it("shows the unwired notice when Prometheus isn't configured", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: false, kubeconfigWired: false },
      }),
    );
    renderShard("bigfleet-shard-0");
    expect(await screen.findByText(/--prometheus-url/)).toBeInTheDocument();
  });

  it("renders detail tiles plus the trend cards when wired", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": wiredConfig,
        "/api/shards/bigfleet-shard-0": shardDetail,
        "/api/shards/bigfleet-shard-0/trends": {
          pod: "bigfleet-shard-0",
          timestamps: [1780000000, 1780000030],
          cycleP99Seconds: [3.1, 3.2],
          actionRates: { Bootstrap: [1.2, 1.3] },
          queriedAt: "",
        },
      }),
    );
    renderShard("bigfleet-shard-0");
    // Detail body landed.
    expect(await screen.findByText("Inventory by state")).toBeInTheDocument();
    // Trend cards landed.
    expect(await screen.findByText("Cycle p99 — last hour")).toBeInTheDocument();
    expect(await screen.findByText("Action rate by kind — last hour")).toBeInTheDocument();
  });

  it("surfaces a trends error without taking down the detail body", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": wiredConfig,
        "/api/shards/bigfleet-shard-0": shardDetail,
        // no /trends route → 404 → ErrorBox in the trend cards
      }),
    );
    renderShard("bigfleet-shard-0");
    expect(await screen.findByText("Inventory by state")).toBeInTheDocument();
    expect(await screen.findByText("Cycle p99 — last hour")).toBeInTheDocument();
    expect((await screen.findAllByText(/no route/)).length).toBeGreaterThan(0);
  });
});
