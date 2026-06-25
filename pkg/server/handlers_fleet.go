package server

import (
	"context"
	"net/http"
	"sort"
	"time"

	v1 "github.com/prometheus/client_golang/api/prometheus/v1"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// PromQL drawn from ../bigfleet/test/scaletest/chart/dashboards/scaletest.json
// (battle-tested by the scaletest runner). Keep these strings literal so a
// quick grep tells you which Grafana panel each one originated from.
const (
	queryShardCount         = `count(rate(bigfleet_shard_cycle_duration_seconds_count[2m]) > 0)`
	queryClusterCount       = `sum(bigfleet_shard_active_sessions)`
	queryShortfalls         = `sum(bigfleet_shard_shortfalls)`
	queryCycleP99WorstShard = `max(histogram_quantile(0.99, sum by (le, pod) (rate(bigfleet_shard_cycle_duration_seconds_bucket[5m]))))`
	queryInventoryByState   = `sum by (state) (bigfleet_shard_inventory_machines)`
	queryActionsByKindRate  = `sum by (kind) (rate(bigfleet_shard_actions_total[5m]))`
)

func (s *Server) fleetOverviewHandler(w http.ResponseWriter, r *http.Request) {
	if !s.prom.Configured() {
		writeError(w, http.StatusServiceUnavailable, "prometheus not configured: pass --prometheus-url")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	now := time.Now()

	shards, err := s.prom.QueryScalar(ctx, queryShardCount, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (shards): "+err.Error())
		return
	}
	clusters, err := s.prom.QueryScalar(ctx, queryClusterCount, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (clusters): "+err.Error())
		return
	}
	shortfalls, err := s.prom.QueryScalar(ctx, queryShortfalls, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (shortfalls): "+err.Error())
		return
	}
	cycleP99, err := s.prom.QueryScalar(ctx, queryCycleP99WorstShard, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (cycle p99): "+err.Error())
		return
	}
	byState, err := s.prom.QueryByLabel(ctx, queryInventoryByState, "state", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (inventory by state): "+err.Error())
		return
	}

	var machines float64
	for _, v := range byState {
		machines += v
	}

	writeJSON(w, http.StatusOK, api.FleetOverview{
		Shards:          int(shards),
		Clusters:        int(clusters),
		Machines:        int(machines),
		MachinesByState: byState,
		Shortfalls:      int(shortfalls),
		CycleP99Seconds: cycleP99,
		QueriedAt:       now.UTC(),
	})
}

func (s *Server) fleetActionsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.prom.Configured() {
		writeError(w, http.StatusServiceUnavailable, "prometheus not configured: pass --prometheus-url")
		return
	}
	q := r.URL.Query()
	duration := parseDuration(q.Get("duration"), time.Hour, 24*time.Hour)
	step := parseDuration(q.Get("step"), 30*time.Second, time.Hour)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	now := time.Now().Truncate(step)
	rng := v1.Range{Start: now.Add(-duration), End: now, Step: step}

	timestamps, series, err := s.prom.QueryRangeByLabel(ctx, queryActionsByKindRate, "kind", rng)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (actions): "+err.Error())
		return
	}

	kinds := make([]string, 0, len(series))
	for k := range series {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	values := make([][]float64, len(kinds))
	for i, k := range kinds {
		values[i] = series[k]
	}

	writeJSON(w, http.StatusOK, api.FleetActionsSeries{
		Timestamps: timestamps,
		Kinds:      kinds,
		Values:     values,
	})
}

func parseDuration(s string, def, max time.Duration) time.Duration {
	if s == "" {
		return def
	}
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return def
	}
	if d > max {
		return max
	}
	return d
}
