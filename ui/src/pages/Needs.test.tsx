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
const wiredConfig = { grafanaUrl: "", prometheusWired: false, coordinatorWired: true, kubeconfigWired: false };
const topology = { coordinator: coordinatorHealth, shards: oneShard, domainAssignments: [], queriedAt: "" };

afterEach(() => vi.restoreAllMocks());

describe("Needs workspace", () => {
  it("shows the unwired notice when the coordinator is not wired", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({ "/api/config": { grafanaUrl: "", prometheusWired: false, coordinatorWired: false, kubeconfigWired: false } }),
    );
    renderWithProviders(<Needs />);
    expect(await screen.findByText(/--coordinator-addr/)).toBeInTheDocument();
  });

  it("scopes to the first cluster and humanizes millicpu + the unmet reason", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": wiredConfig,
        "/api/topology": topology,
        "/api/needs": {
          shardId: "shard-a",
          cycle: 88,
          computedAtUnixNanos: 0,
          totalNeeds: 1,
          needs: [
            {
              clusterId: "payments",
              priority: 1_000_000,
              aggregateResources: { cpu: "8000m" }, // millicpu on the wire …
              interruptionPenaltyBucket: "HALF_DOLLAR",
              reclamationPenaltyBucket: "UNSPECIFIED",
              satisfied: false,
              residualDeficit: { cpu: "8000m" },
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
    expect(await screen.findByText(/payments/)).toBeInTheDocument();
    expect((await screen.findAllByText("priority-starved")).length).toBeGreaterThan(0);
    // … rendered as humanized cores, not "8000m".
    expect(await screen.findByText("8 cpu")).toBeInTheDocument();
  });

  it("opens a causal decision report: aggregation key (with Same), demand shape, decision trace, supply funnel, competition, action", async () => {
    const starved = {
      clusterId: "ml-train-1",
      priority: 8500,
      aggregateResources: { "nvidia.com/gpu": "8", cpu: "128" },
      minUnit: { "nvidia.com/gpu": "1" },
      requirements: [
        { key: "node.kubernetes.io/instance-type", operator: "In", values: ["h100"] },
        { key: "topology.kubernetes.io/zone", operator: "Same", values: [] },
      ],
      spread: [{ topologyKey: "topology.kubernetes.io/zone", maxSkew: 1, whenUnsatisfiable: "DoNotSchedule" }],
      profileFingerprint: "abc123def456ff",
      arrivalUnixNanos: 1_780_000_000_000_000_000,
      interruptionPenaltyBucket: "4096",
      reclamationPenaltyBucket: "256",
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
      reclamationPenaltyBucket: "ZERO",
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
        "/api/config": wiredConfig,
        "/api/topology": topology,
        "/api/needs": { shardId: "shard-a", cycle: 88, computedAtUnixNanos: 0, totalNeeds: 2, needs: [competitor, starved], queriedAt: "" },
      }),
    );
    renderWithProviders(<Needs />);

    const pill = await screen.findByText("priority-starved");
    fireEvent.click(pill.closest("button")!);

    // The aggregation-key card leads the report and renders the Same operator
    // (co-loc shows in both the master row chip and the drawer key card).
    expect(await screen.findByText("Aggregation key")).toBeInTheDocument();
    expect((await screen.findAllByText("co-loc")).length).toBeGreaterThan(0);
    // Demand shape teaches the indivisibility math, ADR-0027-safe.
    expect(await screen.findByText("Demand shape")).toBeInTheDocument();
    expect(await screen.findByText(/not a pod count/)).toBeInTheDocument();
    // Decision trace + supply funnel (matching pool 2+40 = 42).
    expect(await screen.findByText("Decision trace")).toBeInTheDocument();
    expect(await screen.findByText("Supply funnel")).toBeInTheDocument();
    expect((await screen.findAllByText("42")).length).toBeGreaterThan(0);
    // The higher-precedence competitor (claimed 30) shows up ahead in line.
    expect(await screen.findByText("Ahead of you in line")).toBeInTheDocument();
    expect((await screen.findAllByText("30")).length).toBeGreaterThan(0);
    // A recommended action is offered.
    expect(await screen.findByText(/What to do/)).toBeInTheDocument();
  });

  it("shows a satisfied need as held standing state, never an empty 'claimed nothing' waterfall", async () => {
    const stable = {
      clusterId: "stable-svc",
      priority: 5000,
      aggregateResources: { cpu: "240000m" },
      minUnit: { cpu: "8000m" },
      profileFingerprint: "stable-fp",
      arrivalUnixNanos: 1_700_000_000_000_000_000,
      interruptionPenaltyBucket: "1024",
      reclamationPenaltyBucket: "256",
      satisfied: true,
      claimedMachineCount: 30, // standing held-set …
      bootstrapCount: 0, // … with zero acquisition this cycle (steady state)
      provisionCount: 0,
      sameSatisfiable: false,
      acquisitionParked: false,
      ageCyclesUnmet: 0,
      unmetReason: "UNSPECIFIED",
    };
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": wiredConfig,
        "/api/topology": topology,
        "/api/needs": { shardId: "shard-a", cycle: 9, computedAtUnixNanos: 0, totalNeeds: 1, needs: [stable], queriedAt: "" },
      }),
    );
    renderWithProviders(<Needs />);
    const pill = await screen.findByText("satisfied");
    fireEvent.click(pill.closest("button")!);
    // The held panel leads on the standing claim, not the per-cycle delta.
    expect(await screen.findByText("How it's held")).toBeInTheDocument();
    expect((await screen.findAllByText("30")).length).toBeGreaterThan(0);
    expect(await screen.findByText(/machines? held/)).toBeInTheDocument();
    expect(await screen.findByText(/static-stability/)).toBeInTheDocument();
    // The buggy empty/contradictory copy must never appear for a held need.
    expect(screen.queryByText(/claimed nothing/)).toBeNull();
    expect(screen.queryByText("Supply funnel")).toBeNull();
  });

  it("groups a contested shape into a cohort and draws the cut-line", async () => {
    const fp = "shape-fp-77";
    const claiming = {
      clusterId: "team-a",
      priority: 9000,
      aggregateResources: { "nvidia.com/gpu": "8" },
      minUnit: { "nvidia.com/gpu": "8" },
      profileFingerprint: fp,
      arrivalUnixNanos: 1,
      interruptionPenaltyBucket: "ZERO",
      reclamationPenaltyBucket: "ZERO",
      satisfied: true,
      claimedMachineCount: 30,
      bootstrapCount: 0,
      provisionCount: 0,
      sameSatisfiable: false,
      acquisitionParked: false,
      ageCyclesUnmet: 0,
      unmetReason: "UNSPECIFIED",
    };
    const starved = {
      ...claiming,
      priority: 8000,
      arrivalUnixNanos: 2,
      satisfied: false,
      claimedMachineCount: 0,
      residualDeficit: { "nvidia.com/gpu": "8" },
      ageCyclesUnmet: 7,
      unmetReason: "PRIORITY_STARVED",
      matchingSupply: { idle: 0, configured: 30, speculative: 0, capped: false },
    };
    vi.stubGlobal(
      "fetch",
      routeFetch({
        "/api/config": wiredConfig,
        "/api/topology": topology,
        "/api/needs": { shardId: "shard-a", cycle: 5, computedAtUnixNanos: 0, totalNeeds: 2, needs: [claiming, starved], queriedAt: "" },
      }),
    );
    renderWithProviders(<Needs />);
    expect(await screen.findByText(/contested shape/i)).toBeInTheDocument();
    expect(await screen.findByText(/supply exhausted here/i)).toBeInTheDocument();
  });

  it("windows a large single-cluster needs list rather than mounting every row", async () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      clusterId: "big-cluster",
      priority: 1000 + i,
      aggregateResources: { cpu: "1" },
      interruptionPenaltyBucket: "ZERO",
      reclamationPenaltyBucket: "ZERO",
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
        "/api/config": wiredConfig,
        "/api/topology": topology,
        "/api/needs": { shardId: "shard-a", cycle: 1, computedAtUnixNanos: 0, totalNeeds: 400, needs: many },
      }),
    );
    renderWithProviders(<Needs />);
    expect(await screen.findByText("Status")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText("satisfied").length).toBeLessThan(400));
  });
});
