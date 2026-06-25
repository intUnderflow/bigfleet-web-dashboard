package server

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// PromQL drawn from ../bigfleet/test/scaletest/chart/dashboards/scaletest.json,
// adapted to expose per-pod aggregates so the dashboard can list shards.
const (
	queryShardsCycleP99ByPod = `histogram_quantile(0.99, sum by (le, pod) (rate(bigfleet_shard_cycle_duration_seconds_bucket[5m])))`
	queryShardsMachinesByPod = `sum by (pod) (bigfleet_shard_inventory_machines)`
	queryShardsShortfallsByPod = `sum by (pod) (bigfleet_shard_shortfalls)`
	queryShardsSessionsByPod = `sum by (pod) (bigfleet_shard_active_sessions)`
)

func (s *Server) shardsListHandler(w http.ResponseWriter, r *http.Request) {
	if !s.prom.Configured() {
		writeError(w, http.StatusServiceUnavailable, "prometheus not configured: pass --prometheus-url")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	now := time.Now()

	cycleP99, err := s.prom.QueryByLabel(ctx, queryShardsCycleP99ByPod, "pod", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (cycle p99 by pod): "+err.Error())
		return
	}
	machines, err := s.prom.QueryByLabel(ctx, queryShardsMachinesByPod, "pod", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (machines by pod): "+err.Error())
		return
	}
	shortfalls, err := s.prom.QueryByLabel(ctx, queryShardsShortfallsByPod, "pod", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (shortfalls by pod): "+err.Error())
		return
	}
	sessions, err := s.prom.QueryByLabel(ctx, queryShardsSessionsByPod, "pod", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (sessions by pod): "+err.Error())
		return
	}

	// `bigfleet_shard_inventory_machines` is the only metric that's
	// shard-exclusive — the others (shortfalls, sessions, cycle histogram)
	// are registered globally in pkg/metrics, so any binary that imports
	// it (kwok pods, unschedulable-pod-controller, coordinator) exports
	// them as zero and pollutes a naive `by (pod)` aggregation. Anchor
	// the shard list on `machines` and look the rest up against it.
	names := make([]string, 0, len(machines))
	for k := range machines {
		names = append(names, k)
	}
	sort.Strings(names)

	out := make([]api.ShardSummary, 0, len(names))
	for _, pod := range names {
		out = append(out, api.ShardSummary{
			Pod:             pod,
			CycleP99Seconds: cycleP99[pod],
			Machines:        int(machines[pod]),
			Shortfalls:      int(shortfalls[pod]),
			ActiveSessions:  int(sessions[pod]),
		})
	}

	writeJSON(w, http.StatusOK, api.ShardsList{
		Shards:    out,
		QueriedAt: now.UTC(),
	})
}

var podNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,252}$`)

func (s *Server) shardDetailHandler(w http.ResponseWriter, r *http.Request) {
	if !s.prom.Configured() {
		writeError(w, http.StatusServiceUnavailable, "prometheus not configured: pass --prometheus-url")
		return
	}
	pod := r.PathValue("pod")
	if !podNameRE.MatchString(pod) {
		writeError(w, http.StatusBadRequest, "invalid pod name")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	now := time.Now()

	cycleP99, err := s.prom.QueryScalar(ctx,
		fmt.Sprintf(`histogram_quantile(0.99, sum by (le) (rate(bigfleet_shard_cycle_duration_seconds_bucket{pod=%q}[5m])))`, pod), now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (cycle p99): "+err.Error())
		return
	}
	phaseP99, err := s.prom.QueryByLabel(ctx,
		fmt.Sprintf(`histogram_quantile(0.99, sum by (le, phase) (rate(bigfleet_shard_cycle_phase_duration_seconds_bucket{pod=%q}[5m])))`, pod),
		"phase", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (phase p99): "+err.Error())
		return
	}
	byState, err := s.prom.QueryByLabel(ctx,
		fmt.Sprintf(`sum by (state) (bigfleet_shard_inventory_machines{pod=%q})`, pod),
		"state", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (inventory by state): "+err.Error())
		return
	}
	byCapacity, err := s.prom.QueryByLabel(ctx,
		fmt.Sprintf(`sum by (capacity_type) (bigfleet_shard_inventory_machines{pod=%q})`, pod),
		"capacity_type", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (inventory by capacity_type): "+err.Error())
		return
	}
	shortfalls, err := s.prom.QueryScalar(ctx,
		fmt.Sprintf(`sum(bigfleet_shard_shortfalls{pod=%q})`, pod), now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (shortfalls): "+err.Error())
		return
	}
	sessions, err := s.prom.QueryScalar(ctx,
		fmt.Sprintf(`sum(bigfleet_shard_active_sessions{pod=%q})`, pod), now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (sessions): "+err.Error())
		return
	}
	actionsByKind, err := s.prom.QueryByLabel(ctx,
		fmt.Sprintf(`sum by (kind) (rate(bigfleet_shard_actions_total{pod=%q}[5m]))`, pod),
		"kind", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (actions by kind): "+err.Error())
		return
	}
	occCommitted, err := s.prom.QueryScalar(ctx,
		fmt.Sprintf(`sum(rate(bigfleet_shard_phase1_occ_proposals_total{pod=%q,outcome="committed"}[5m]))`, pod), now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (occ committed): "+err.Error())
		return
	}
	occConflict, err := s.prom.QueryScalar(ctx,
		fmt.Sprintf(`sum(rate(bigfleet_shard_phase1_occ_proposals_total{pod=%q,outcome="conflict"}[5m]))`, pod), now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (occ conflict): "+err.Error())
		return
	}

	machines := 0.0
	for _, v := range byState {
		machines += v
	}

	writeJSON(w, http.StatusOK, api.ShardDetail{
		Pod:                    pod,
		CycleP99Seconds:        cycleP99,
		CycleP99ByPhaseSeconds: phaseP99,
		Machines:               int(machines),
		MachinesByState:        byState,
		MachinesByCapacityType: byCapacity,
		Shortfalls:             int(shortfalls),
		ActiveSessions:         int(sessions),
		ActionsByKindRatePerSec: actionsByKind,
		OCCCommittedPerSec:     occCommitted,
		OCCConflictPerSec:      occConflict,
		QueriedAt:              now.UTC(),
	})
}
