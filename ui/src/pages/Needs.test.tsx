import type { ReactElement } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Needs from "./Needs";

// routeFetch answers by request path (query string ignored), so /api/needs
// matches regardless of its shard/cluster params.
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

const coordinatorHealth = { raftTerm: 1, applyRatePerSec: 0, applyErrorRatePerSec: 0, pendingInstructionsTotal: 0 };
const oneShard = [{ shardId: "shard-a", address: "", registeredAtUnixSec: 0, lastHeartbeatUnixSec: 0, pendingInstructions: 0 }];

afterEach(() => vi.restoreAllMocks());

describe("Needs explorer", () => {
  it("shows the unwired notice when the coordinator is not wired", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: false, kubeconfigWired: false },
      }),
    );
    renderWithProviders(<Needs />);
    expect(await screen.findByText(/--coordinator-addr/)).toBeInTheDocument();
  });

  it("scopes to the first cluster and shows a humanized unmet reason", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: true, kubeconfigWired: false },
        "/api/topology": {
          coordinator: coordinatorHealth,
          shards: oneShard,
          domainAssignments: [],
          queriedAt: "",
        },
        "/api/needs": {
          shardId: "shard-a",
          cycle: 88,
          computedAtUnixNanos: 0,
          totalNeeds: 1,
          needs: [
            {
              clusterId: "payments",
              priority: 1_000_000,
              aggregateResources: { cpu: "8" },
              interruptionPenaltyBucket: "PINNED",
              reclamationPenaltyBucket: "ZERO",
              satisfied: false,
              residualDeficit: { cpu: "8" },
              claimedMachineCount: 0,
              bootstrapCount: 0,
              provisionCount: 0,
              sameSatisfiable: false,
              acquisitionParked: false,
              ageCyclesUnmet: 3,
              unmetReason: "PRIORITY_STARVED",
            },
          ],
          queriedAt: "",
        },
      }),
    );
    renderWithProviders(<Needs />);
    // The cluster appears as a selectable scope (option text "payments (1 · 1 unmet)").
    expect(await screen.findByText(/payments/)).toBeInTheDocument();
    // The raw enum is humanized; it shows in both the status pill and the summary bar.
    expect((await screen.findAllByText("priority-starved")).length).toBeGreaterThan(0);
    // The demand cell renders the wanted resources compactly.
    expect(await screen.findByText("8 cpu")).toBeInTheDocument();
  });

  it("opens a decision report with supply arithmetic, matching-supply cardinality, competitors, and an action", async () => {
    const starved = {
      clusterId: "ml-train-1",
      priority: 8500,
      aggregateResources: { "nvidia.com/gpu": "8", cpu: "128" },
      minUnit: { "nvidia.com/gpu": "1" },
      group: "gang-7",
      interruptionPenaltyBucket: "$4096",
      reclamationPenaltyBucket: "$256",
      satisfied: false,
      residualDeficit: { "nvidia.com/gpu": "4" },
      claimedMachineCount: 4,
      bootstrapCount: 3,
      provisionCount: 1,
      sameSatisfiable: false,
      acquisitionParked: false,
      ageCyclesUnmet: 12,
      unmetReason: "PRIORITY_STARVED",
      matchingSupply: { idle: 2, configured: 40, speculative: 0, capped: false },
    };
    const competitor = {
      clusterId: "ml-train-1",
      priority: 9000,
      aggregateResources: { "nvidia.com/gpu": "8" },
      interruptionPenaltyBucket: "PINNED",
      reclamationPenaltyBucket: "$0",
      satisfied: true,
      claimedMachineCount: 30,
      bootstrapCount: 0,
      provisionCount: 0,
      sameSatisfiable: false,
      acquisitionParked: false,
      ageCyclesUnmet: 0,
      unmetReason: "UNSPECIFIED",
    };
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: true, kubeconfigWired: false },
        "/api/topology": { coordinator: coordinatorHealth, shards: oneShard, domainAssignments: [], queriedAt: "" },
        "/api/needs": { shardId: "shard-a", cycle: 88, computedAtUnixNanos: 0, totalNeeds: 2, needs: [competitor, starved], queriedAt: "" },
      }),
    );
    renderWithProviders(<Needs />);

    const pill = await screen.findByText("priority-starved");
    const row = pill.closest("button");
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    // The decision report panel opens with its sections.
    expect(await screen.findByText("Supply arithmetic")).toBeInTheDocument();
    expect(await screen.findByText("Matching supply in inventory")).toBeInTheDocument();
    // The configured cardinality (40) is surfaced.
    expect(await screen.findByText("40")).toBeInTheDocument();
    // The competitor (higher precedence, claimed 30) shows up "ahead in line".
    expect(await screen.findByText("Ahead of you in line")).toBeInTheDocument();
    expect(await screen.findByText("30")).toBeInTheDocument();
    // A recommended action is offered.
    expect(await screen.findByText(/What to do/)).toBeInTheDocument();
  });

  it("windows a large single-cluster needs list rather than mounting every row", async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      clusterId: "big-cluster",
      priority: 1000 + i,
      aggregateResources: { cpu: "1" },
      interruptionPenaltyBucket: "1",
      reclamationPenaltyBucket: "0",
      satisfied: true,
      claimedMachineCount: 1,
      bootstrapCount: 0,
      provisionCount: 0,
      sameSatisfiable: false,
      acquisitionParked: false,
      ageCyclesUnmet: 0,
      unmetReason: "UNSPECIFIED",
    }));
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: true, kubeconfigWired: false },
        "/api/topology": {
          coordinator: coordinatorHealth,
          shards: oneShard,
          domainAssignments: [],
          queriedAt: "",
        },
        "/api/needs": { shardId: "shard-a", cycle: 1, computedAtUnixNanos: 0, totalNeeds: 400, needs: many },
      }),
    );
    renderWithProviders(<Needs />);
    // The table header renders (table mounted) ...
    expect(await screen.findByText("Status")).toBeInTheDocument();
    // ... but far fewer than all 400 status pills are in the DOM (windowed).
    await waitFor(() => expect(screen.queryAllByText("satisfied").length).toBeLessThan(400));
  });
});
