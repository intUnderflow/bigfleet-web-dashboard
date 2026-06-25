package api

import "time"

type HealthResponse struct {
	Status string `json:"status"`
}

type ClientConfig struct {
	GrafanaURL       string `json:"grafanaUrl"`
	PrometheusWired  bool   `json:"prometheusWired"`
	CoordinatorWired bool   `json:"coordinatorWired"`
	KubeconfigWired  bool   `json:"kubeconfigWired"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type FleetOverview struct {
	Shards          int                `json:"shards"`
	Clusters        int                `json:"clusters"`
	Machines        int                `json:"machines"`
	MachinesByState map[string]float64 `json:"machinesByState"`
	Shortfalls      int                `json:"shortfalls"`
	CycleP99Seconds float64            `json:"cycleP99Seconds"`
	QueriedAt       time.Time          `json:"queriedAt"`
}

type FleetActionsSeries struct {
	Timestamps []int64     `json:"timestamps"`
	Kinds      []string    `json:"kinds"`
	Values     [][]float64 `json:"values"`
}

type ShardSummary struct {
	Pod             string  `json:"pod"`
	CycleP99Seconds float64 `json:"cycleP99Seconds"`
	Machines        int     `json:"machines"`
	Shortfalls      int     `json:"shortfalls"`
	ActiveSessions  int     `json:"activeSessions"`
}

type ShardsList struct {
	Shards    []ShardSummary `json:"shards"`
	QueriedAt time.Time      `json:"queriedAt"`
}

type ClusterSummary struct {
	ID                      string  `json:"id"`
	CapacityRequests        int     `json:"capacityRequests"`
	CapacityRequestsPending int     `json:"capacityRequestsPending"`
	UpcomingNodes           int     `json:"upcomingNodes"`
	Error                   *string `json:"error,omitempty"`
}

type ClustersList struct {
	Clusters  []ClusterSummary `json:"clusters"`
	QueriedAt time.Time        `json:"queriedAt"`
}

type CoordinatorHealth struct {
	RaftTerm                 int     `json:"raftTerm"`
	ApplyRatePerSec          float64 `json:"applyRatePerSec"`
	ApplyErrorRatePerSec     float64 `json:"applyErrorRatePerSec"`
	PendingInstructionsTotal int     `json:"pendingInstructionsTotal"`
}

type TopologyShard struct {
	ShardID              string `json:"shardId"`
	Address              string `json:"address"`
	RegisteredAtUnixSec  int64  `json:"registeredAtUnixSec"`
	LastHeartbeatUnixSec int64  `json:"lastHeartbeatUnixSec"`
	PendingInstructions  int    `json:"pendingInstructions"`
}

type TopologyDomainAssignment struct {
	TopologyKey   string `json:"topologyKey"`
	TopologyValue string `json:"topologyValue"`
	ShardID       string `json:"shardId"`
}

type TopologyQuota struct {
	Provider string         `json:"provider"`
	Region   string         `json:"region"`
	PerShard map[string]int `json:"perShard"`
}

type FinOpsRedFlag struct {
	Severity     string  `json:"severity"`
	CapacityType string  `json:"capacityType"`
	Bucket       string  `json:"bucket"`
	Count        float64 `json:"count"`
	Message      string  `json:"message"`
}

type FinOpsTotals struct {
	ConfiguredMachines       int     `json:"configuredMachines"`
	IdleMachines             int     `json:"idleMachines"`
	DemandMachines           int     `json:"demandMachines"`
	SpotConfiguredFraction   float64 `json:"spotConfiguredFraction"`
	PinnedConfiguredFraction float64 `json:"pinnedConfiguredFraction"`
}

type FinOpsSnapshot struct {
	Totals                   FinOpsTotals                  `json:"totals"`
	CapacityTypes            []string                      `json:"capacityTypes"`
	Buckets                  []string                      `json:"buckets"`
	ConfiguredByCapacityType map[string]float64            `json:"configuredByCapacityType"`
	IdleByCapacityType       map[string]float64            `json:"idleByCapacityType"`
	Configured               map[string]map[string]float64 `json:"configured"`
	ConfiguredByBucket       map[string]float64            `json:"configuredByBucket"`
	Demand                   map[string]float64            `json:"demand"`
	ActionRatesPerSec        map[string]float64            `json:"actionRatesPerSec"`
	RedFlags                 []FinOpsRedFlag               `json:"redFlags"`
	QueriedAt                time.Time                     `json:"queriedAt"`
}

type Topology struct {
	Coordinator       CoordinatorHealth          `json:"coordinator"`
	Shards            []TopologyShard            `json:"shards"`
	DomainAssignments []TopologyDomainAssignment `json:"domainAssignments"`
	Quotas            []TopologyQuota            `json:"quotas"`
	Warnings          []string                   `json:"warnings,omitempty"`
	QueriedAt         time.Time                  `json:"queriedAt"`
}

type ClusterDetail struct {
	ID                      string         `json:"id"`
	CapacityRequestsTotal   int            `json:"capacityRequestsTotal"`
	CapacityRequestsByPhase map[string]int `json:"capacityRequestsByPhase"`
	UpcomingNodesTotal      int            `json:"upcomingNodesTotal"`
	UpcomingNodesByPhase    map[string]int `json:"upcomingNodesByPhase"`
	QueriedAt               time.Time      `json:"queriedAt"`
}

type ShardDetail struct {
	Pod                     string             `json:"pod"`
	CycleP99Seconds         float64            `json:"cycleP99Seconds"`
	CycleP99ByPhaseSeconds  map[string]float64 `json:"cycleP99ByPhaseSeconds"`
	Machines                int                `json:"machines"`
	MachinesByState         map[string]float64 `json:"machinesByState"`
	MachinesByCapacityType  map[string]float64 `json:"machinesByCapacityType"`
	Shortfalls              int                `json:"shortfalls"`
	ActiveSessions          int                `json:"activeSessions"`
	ActionsByKindRatePerSec map[string]float64 `json:"actionsByKindRatePerSec"`
	OCCCommittedPerSec      float64            `json:"occCommittedPerSec"`
	OCCConflictPerSec       float64            `json:"occConflictPerSec"`
	QueriedAt               time.Time          `json:"queriedAt"`
}
