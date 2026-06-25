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

export interface TopologyQuota {
  provider: string;
  region: string;
  perShard: Record<string, number>;
}

export interface Topology {
  coordinator: CoordinatorHealth;
  shards: TopologyShard[];
  domainAssignments: TopologyDomainAssignment[];
  quotas: TopologyQuota[];
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

export interface Provider {
  name: string;
  address: string;
  region: string;
}

export interface ProvidersListResponse {
  providers: Provider[];
  queriedAt: string;
}

export interface ErrorResponse {
  error: string;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
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
  clusters: () => getJSON<ClustersListResponse>("/api/clusters"),
  cluster: (id: string) => getJSON<ClusterDetail>(`/api/clusters/${encodeURIComponent(id)}`),
  topology: () => getJSON<Topology>("/api/topology"),
  providers: () => getJSON<ProvidersListResponse>("/api/providers"),
  finopsSnapshot: () => getJSON<FinOpsSnapshot>("/api/finops/snapshot"),
};
