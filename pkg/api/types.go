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

// ShardReportSummary is the inventory headline from a shard's last report.
type ShardReportSummary struct {
	TotalMachines      int            `json:"totalMachines"`
	FreeMachines       int            `json:"freeMachines"`
	InstanceTypeCounts map[string]int `json:"instanceTypeCounts"`
	ZoneCounts         map[string]int `json:"zoneCounts"`
	// ProviderAddress is the out-of-tree provider the shard is bound to
	// (its --provider-addr); empty = the in-process fake (not deployed).
	ProviderAddress string `json:"providerAddress"`
}

// ShardReportShortfall is one unsatisfied need the shard reported. The
// coordinator's soft state does not retain the original requirements
// (ADR-0060), only the fields below.
type ShardReportShortfall struct {
	Priority      int               `json:"priority"`
	Deficit       map[string]string `json:"deficit"`
	AgeCycles     int               `json:"ageCycles"`
	PenaltyBucket string            `json:"penaltyBucket"`
}

// ShardReport is the coordinator's leader-local soft-state snapshot of one
// shard (coordinator ListShardReports). receivedAtUnixNs lets the UI label
// freshness; the list is empty right after a failover until shards re-report.
type ShardReport struct {
	ShardID          string                 `json:"shardId"`
	Cycle            int64                  `json:"cycle"`
	ReceivedAtUnixNs int64                  `json:"receivedAtUnixNs"`
	Summary          *ShardReportSummary    `json:"summary,omitempty"`
	Shortfalls       []ShardReportShortfall `json:"shortfalls,omitempty"`
}

type ShardReportsList struct {
	Reports   []ShardReport `json:"reports"`
	QueriedAt time.Time     `json:"queriedAt"`
}

// NeedView is one Need's last-cycle verdict from a shard's
// ShardRead.InspectNeeds (ADR-0061).
type NeedView struct {
	ClusterID                 string            `json:"clusterId"`
	Priority                  int               `json:"priority"`
	AggregateResources        map[string]string `json:"aggregateResources"`
	MinUnit                   map[string]string `json:"minUnit,omitempty"`
	Group                     string            `json:"group,omitempty"`
	Requirements              []string          `json:"requirements,omitempty"`
	InterruptionPenaltyBucket string            `json:"interruptionPenaltyBucket"`
	ReclamationPenaltyBucket  string            `json:"reclamationPenaltyBucket"`
	Satisfied                 bool              `json:"satisfied"`
	ResidualDeficit           map[string]string `json:"residualDeficit,omitempty"`
	ClaimedMachineCount       int               `json:"claimedMachineCount"`
	BootstrapCount            int               `json:"bootstrapCount"`
	ProvisionCount            int               `json:"provisionCount"`
	SameDomain                string            `json:"sameDomain,omitempty"`
	SameSatisfiable           bool              `json:"sameSatisfiable"`
	AcquisitionParked         bool              `json:"acquisitionParked"`
	ParkedAgeCycles           int               `json:"parkedAgeCycles,omitempty"`
	AgeCyclesUnmet            int               `json:"ageCyclesUnmet"`
	UnmetReason               string            `json:"unmetReason"`

	// ADR-0061 amendment decision context (observation-only).
	MatchingSupply *MatchingSupply    `json:"matchingSupply,omitempty"`
	Preemption     *PreemptionSummary `json:"preemption,omitempty"`
	SameCandidates []DomainCoverage   `json:"sameCandidates,omitempty"`
}

// MatchingSupply is the per-state count of machines matching an unsatisfied
// Need's shape; capped is true if any state hit the engine's count cap.
type MatchingSupply struct {
	Idle        int  `json:"idle"`
	Configured  int  `json:"configured"`
	Speculative int  `json:"speculative"`
	Capped      bool `json:"capped"`
}

// PreemptionSummary is Phase 2's preemption attempt for a still-unmet Need.
type PreemptionSummary struct {
	VictimsFound  int               `json:"victimsFound"`
	CapacityFreed map[string]string `json:"capacityFreed,omitempty"`
}

// DomainCoverage is one candidate topology domain the Same pre-pass weighed.
type DomainCoverage struct {
	Domain           string `json:"domain"`
	CoveragePerMille int    `json:"coveragePerMille"`
	Satisfiable      bool   `json:"satisfiable"`
}

// NeedsResponse is one shard's needs snapshot. cycle 0 with no needs means
// the shard is rebuilding its ledger (e.g. just after a restart), not "no
// demand".
type NeedsResponse struct {
	ShardID             string     `json:"shardId"`
	Cycle               int64      `json:"cycle"`
	ComputedAtUnixNanos int64      `json:"computedAtUnixNanos"`
	TotalNeeds          int        `json:"totalNeeds"`
	Needs               []NeedView `json:"needs"`
	QueriedAt           time.Time  `json:"queriedAt"`
}

// AvailableCapacityItem is one AvailableCapacity CR's hint.
type AvailableCapacityItem struct {
	Name           string            `json:"name"`
	Resources      map[string]string `json:"resources,omitempty"`
	AvailableCount int               `json:"availableCount"`
	Availability   string            `json:"availability"`
	Cost           string            `json:"cost"`
	Requirements   []string          `json:"requirements,omitempty"`
}

// AvailableCapacityCluster groups one managed cluster's AvailableCapacity
// hints; Error is set (and Items empty) when that cluster's read failed.
type AvailableCapacityCluster struct {
	ID    string                  `json:"id"`
	Items []AvailableCapacityItem `json:"items"`
	Error *string                 `json:"error,omitempty"`
}

type AvailableCapacityResponse struct {
	Clusters  []AvailableCapacityCluster `json:"clusters"`
	QueriedAt time.Time                  `json:"queriedAt"`
}

// ShardTrends is a shard pod's short-window history: aligned timestamps with
// the cycle-p99 series and per-kind action-rate series (roadmap v0.4).
type ShardTrends struct {
	Pod             string               `json:"pod"`
	Timestamps      []int64              `json:"timestamps"`
	CycleP99Seconds []float64            `json:"cycleP99Seconds"`
	ActionRates     map[string][]float64 `json:"actionRates"`
	QueriedAt       time.Time            `json:"queriedAt"`
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
