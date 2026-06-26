package server

import (
	"context"
	"net/http"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
)

// shardReportsHandler serves /api/shard-reports — the coordinator's
// leader-local soft-state snapshot per shard (ADR-0060 ListShardReports):
// the latest ShardSummary + outstanding shortfalls it accumulated from each
// shard's heartbeat. Stale-on-failover by design; receivedAtUnixNs lets the
// caller judge freshness. Optional ?shard=<id> restricts to one shard.
func (s *Server) shardReportsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.coord.Configured() {
		writeError(w, http.StatusServiceUnavailable, "coordinator not configured: pass --coordinator-addr")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	reports, err := s.coord.ListShardReports(ctx, r.URL.Query().Get("shard"))
	if err != nil {
		writeError(w, statusFromCoordErr(err), "coordinator ListShardReports: "+err.Error())
		return
	}

	out := make([]api.ShardReport, 0, len(reports))
	for _, rep := range reports {
		out = append(out, toAPIShardReport(rep))
	}
	writeJSON(w, http.StatusOK, api.ShardReportsList{Reports: out, QueriedAt: time.Now().UTC()})
}

func toAPIShardReport(rep coordclient.ShardReport) api.ShardReport {
	r := api.ShardReport{
		ShardID:          rep.ShardID,
		Cycle:            rep.Cycle,
		ReceivedAtUnixNs: rep.ReceivedAtUnixNs,
	}
	if rep.Summary != nil {
		r.Summary = &api.ShardReportSummary{
			TotalMachines:      int(rep.Summary.TotalMachines),
			FreeMachines:       int(rep.Summary.FreeMachines),
			InstanceTypeCounts: int32MapToInt(rep.Summary.InstanceTypeCounts),
			ZoneCounts:         int32MapToInt(rep.Summary.ZoneCounts),
			ProviderAddress:    rep.Summary.ProviderAddress,
		}
	}
	r.Shortfalls = make([]api.ShardReportShortfall, 0, len(rep.Shortfalls))
	for _, sf := range rep.Shortfalls {
		r.Shortfalls = append(r.Shortfalls, api.ShardReportShortfall{
			Priority:      int(sf.Priority),
			Deficit:       sf.Deficit,
			AgeCycles:     int(sf.AgeCycles),
			PenaltyBucket: sf.PenaltyBucket,
		})
	}
	return r
}

func int32MapToInt(in map[string]int32) map[string]int {
	if in == nil {
		return nil
	}
	out := make(map[string]int, len(in))
	for k, v := range in {
		out[k] = int(v)
	}
	return out
}
