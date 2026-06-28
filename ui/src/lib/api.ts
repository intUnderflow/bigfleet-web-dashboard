export interface HealthResponse {
  status: string;
}

export interface ClientConfig {
  grafanaUrl: string;
  prometheusWired: boolean;
  coordinatorWired: boolean;
  kubeconfigWired: boolean;
}

export interface FleetOverview {
  shards: number;
  clusters: number;
  machines: number;
  machinesByState: Record<string, number>;
  shortfalls: number;
  cycleP99Seconds: number;
  queriedAt: string;
}

export interface FleetActionsSeries {
  timestamps: number[];
  kinds: string[];
  values: number[][];
}

export interface ShardSummary {
  pod: string;
  cycleP99Seconds: number;
  machines: number;
  shortfalls: number;
  activeSessions: number;
}

export interface ShardsList {
  shards: ShardSummary[];
  queriedAt: string;
}

export interface FinOpsRedFlag {
  severity: "warn" | "danger";
  capacityType: string;
  bucket: string;
  count: number;
  message: string;
}

export interface FinOpsTotals {
  configuredMachines: number;
  idleMachines: number;
  demandMachines: number;
  spotConfiguredFraction: number;
  pinnedConfiguredFraction: number;
}

export interface FinOpsSnapshot {
  totals: FinOpsTotals;
  capacityTypes: string[];
  buckets: string[];
  configuredByCapacityType: Record<string, number>;
  idleByCapacityType: Record<string, number>;
  configured: Record<string, Record<string, number>>;
  configuredByBucket: Record<string, number>;
  demand: Record<string, number>;
  actionRatesPerSec: Record<string, number>;
  redFlags: FinOpsRedFlag[];
  queriedAt: string;
}

export interface CoordinatorHealth {
  raftTerm: number;
  applyRatePerSec: number;
  applyErrorRatePerSec: number;
  pendingInstructionsTotal: number;
}

export interface TopologyShard {
  shardId: string;
  address: string;
  registeredAtUnixSec: number;
  lastHeartbeatUnixSec: number;
  pendingInstructions: number;
}

export interface TopologyDomainAssignment {
  topologyKey: string;
  topologyValue: string;
  shardId: string;
}

export interface Topology {
  coordinator: CoordinatorHealth;
  shards: TopologyShard[];
  domainAssignments: TopologyDomainAssignment[];
  warnings?: string[];
  queriedAt: string;
}

export interface ClusterSummary {
  id: string;
  capacityRequests: number;
  capacityRequestsPending: number;
  upcomingNodes: number;
  error?: string;
}

export interface ClustersListResponse {
  clusters: ClusterSummary[];
  queriedAt: string;
}

export interface ClusterDetail {
  id: string;
  capacityRequestsTotal: number;
  capacityRequestsByPhase: Record<string, number>;
  upcomingNodesTotal: number;
  upcomingNodesByPhase: Record<string, number>;
  queriedAt: string;
}

export interface ShardTrends {
  pod: string;
  timestamps: number[];
  cycleP99Seconds: number[];
  actionRates: Record<string, number[]>;
  queriedAt: string;
}

export interface ShardDetail {
  pod: string;
  cycleP99Seconds: number;
  cycleP99ByPhaseSeconds: Record<string, number>;
  machines: number;
  machinesByState: Record<string, number>;
  machinesByCapacityType: Record<string, number>;
  shortfalls: number;
  activeSessions: number;
  actionsByKindRatePerSec: Record<string, number>;
  occCommittedPerSec: number;
  occConflictPerSec: number;
  queriedAt: string;
}

export interface ShardReportSummary {
  totalMachines: number;
  freeMachines: number;
  instanceTypeCounts: Record<string, number>;
  zoneCounts: Record<string, number>;
  // The out-of-tree provider the shard is bound to (its --provider-addr);
  // empty = the in-process fake (not deployed).
  providerAddress: string;
}

export interface ShardReportShortfall {
  priority: number;
  deficit: Record<string, string>;
  ageCycles: number;
  penaltyBucket: string;
}

export interface ShardReport {
  shardId: string;
  cycle: number;
  receivedAtUnixNs: number;
  summary?: ShardReportSummary;
  shortfalls?: ShardReportShortfall[];
}

export interface ShardReportsListResponse {
  reports: ShardReport[];
  queriedAt: string;
}

export interface AvailableCapacityItem {
  name: string;
  resources?: Record<string, string>;
  availableCount: number;
  availability: string;
  cost: string;
  requirements?: string[];
}

export interface AvailableCapacityCluster {
  id: string;
  items: AvailableCapacityItem[];
  error?: string;
}

export interface AvailableCapacityResponse {
  clusters: AvailableCapacityCluster[];
  queriedAt: string;
}

export interface MatchingSupply {
  idle: number;
  configured: number;
  speculative: number;
  capped: boolean;
}

export interface PreemptionSummary {
  victimsFound: number;
  capacityFreed?: Record<string, string>;
}

export interface DomainCoverage {
  domain: string;
  coveragePerMille: number;
  satisfiable: boolean;
}

// One node-selector term of a Need's aggregation key. operator is one of
// In | NotIn | Exists | DoesNotExist | Same (Same = co-location, gang signal).
export interface Requirement {
  key: string;
  operator: string;
  values?: string[];
}

// One spread term of a Need's aggregation key.
export interface TopologySpread {
  topologyKey: string;
  maxSkew: number;
  whenUnsatisfiable?: string; // DoNotSchedule | ScheduleAnyway
}

export interface NeedView {
  clusterId: string;
  priority: number;
  aggregateResources: Record<string, string>;
  minUnit?: Record<string, string>;
  group?: string;
  requirements?: Requirement[];
  spread?: TopologySpread[];
  interruptionPenaltyBucket: string;
  reclamationPenaltyBucket: string;
  satisfied: boolean;
  residualDeficit?: Record<string, string>;
  claimedMachineCount: number;
  bootstrapCount: number;
  provisionCount: number;
  sameDomain?: string;
  sameSatisfiable: boolean;
  acquisitionParked: boolean;
  parkedAgeCycles?: number;
  ageCyclesUnmet: number;
  unmetReason: string;
  arrivalUnixNanos?: number;
  profileFingerprint?: string;
  // ADR-0061 amendment decision context (observation-only).
  matchingSupply?: MatchingSupply;
  preemption?: PreemptionSummary;
  sameCandidates?: DomainCoverage[];
}

export interface NeedsResponse {
  shardId: string;
  cycle: number;
  computedAtUnixNanos: number;
  totalNeeds: number;
  needs: NeedView[];
  queriedAt: string;
}

export interface ErrorResponse {
  error: string;
}

// Build-time base path (vite.config.ts) prefixed onto every request, so the
// root-absolute /api/... paths land under the reverse-proxy prefix; "" for a
// standalone build at "/". A prefix-stripping proxy maps /fleet-dash/api/... →
// the server's /api/... (see README).
function apiBase(): string {
  return import.meta.env.BASE_URL.replace(/\/+$/, "");
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(apiBase() + path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as ErrorResponse;
      if (body.error) detail = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => getJSON<HealthResponse>("/api/health"),
  config: () => getJSON<ClientConfig>("/api/config"),
  fleetOverview: () => getJSON<FleetOverview>("/api/fleet/overview"),
  fleetActions: (duration = "1h", step = "30s") =>
    getJSON<FleetActionsSeries>(
      `/api/fleet/actions?duration=${encodeURIComponent(duration)}&step=${encodeURIComponent(step)}`
    ),
  shards: () => getJSON<ShardsList>("/api/shards"),
  shard: (pod: string) => getJSON<ShardDetail>(`/api/shards/${encodeURIComponent(pod)}`),
  shardTrends: (pod: string, duration = "1h", step = "30s") =>
    getJSON<ShardTrends>(
      `/api/shards/${encodeURIComponent(pod)}/trends?duration=${encodeURIComponent(duration)}&step=${encodeURIComponent(step)}`
    ),
  clusters: () => getJSON<ClustersListResponse>("/api/clusters"),
  cluster: (id: string) => getJSON<ClusterDetail>(`/api/clusters/${encodeURIComponent(id)}`),
  availableCapacity: () => getJSON<AvailableCapacityResponse>("/api/available-capacity"),
  topology: () => getJSON<Topology>("/api/topology"),
  shardReports: () => getJSON<ShardReportsListResponse>("/api/shard-reports"),
  needs: (shard: string, limit = 0) =>
    getJSON<NeedsResponse>(
      `/api/needs?shard=${encodeURIComponent(shard)}` + (limit ? `&limit=${limit}` : "")
    ),
  finopsSnapshot: () => getJSON<FinOpsSnapshot>("/api/finops/snapshot"),
};
