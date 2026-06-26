package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	v1 "github.com/prometheus/client_golang/api/prometheus/v1"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// shardTrendsHandler serves /api/shards/{pod}/trends?duration=&step= — the
// pod's short-window history (roadmap v0.4): cycle-p99 over time + action
// rate by kind over time, both as Prometheus range queries sharing one time
// axis.
func (s *Server) shardTrendsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.prom.Configured() {
		writeError(w, http.StatusServiceUnavailable, "prometheus not configured: pass --prometheus-url")
		return
	}
	pod := r.PathValue("pod")
	if !podNameRE.MatchString(pod) {
		writeError(w, http.StatusBadRequest, "invalid pod name")
		return
	}
	q := r.URL.Query()
	duration := parseDuration(q.Get("duration"), time.Hour, 24*time.Hour)
	step := parseDuration(q.Get("step"), 30*time.Second, time.Hour)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	now := time.Now().Truncate(step)
	rng := v1.Range{Start: now.Add(-duration), End: now, Step: step}

	// Group the p99 by pod so the single series comes back keyed; pick it out.
	timestamps, cycleByPod, err := s.prom.QueryRangeByLabel(ctx,
		fmt.Sprintf(`histogram_quantile(0.99, sum by (le, pod) (rate(bigfleet_shard_cycle_duration_seconds_bucket{pod=%q}[5m])))`, pod),
		"pod", rng)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (cycle p99 trend): "+err.Error())
		return
	}

	_, actionRates, err := s.prom.QueryRangeByLabel(ctx,
		fmt.Sprintf(`sum by (kind) (rate(bigfleet_shard_actions_total{pod=%q}[5m]))`, pod),
		"kind", rng)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (action rate trend): "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, api.ShardTrends{
		Pod:             pod,
		Timestamps:      timestamps,
		CycleP99Seconds: cycleByPod[pod],
		ActionRates:     actionRates,
		QueriedAt:       now.UTC(),
	})
}
