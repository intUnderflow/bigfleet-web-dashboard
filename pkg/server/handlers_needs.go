package server

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/shardclient"
)

const defaultNeedsLimit = 2000

// needsHandler serves /api/needs?shard=<id>&cluster=<id>&limit=<n> — one
// shard's last-cycle per-Need verdicts (ADR-0061). The shard is required:
// needs live in shards, so the explorer is shard-scoped (the dashboard
// discovers the shard's address from the coordinator, then dials it
// directly). The optional cluster filter narrows to one cluster's needs.
func (s *Server) needsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.coord.Configured() {
		writeError(w, http.StatusServiceUnavailable, "coordinator not configured: pass --coordinator-addr")
		return
	}
	shardID := r.URL.Query().Get("shard")
	if shardID == "" {
		writeError(w, http.StatusBadRequest, "shard query parameter required (pick a shard from the Topology view)")
		return
	}
	cluster := r.URL.Query().Get("cluster")
	limit := defaultNeedsLimit
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	shards, err := s.coord.ListShards(ctx)
	if err != nil {
		writeError(w, statusFromCoordErr(err), "coordinator ListShards: "+err.Error())
		return
	}
	addr := ""
	for _, sd := range shards {
		if sd.ShardID == shardID {
			addr = sd.Address
			break
		}
	}
	if addr == "" {
		writeError(w, http.StatusNotFound, "shard not found or has no advertised address: "+shardID)
		return
	}

	snap, err := s.shardNeeds.InspectNeeds(ctx, addr, cluster, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "shard InspectNeeds: "+err.Error())
		return
	}

	out := make([]api.NeedView, 0, len(snap.Needs))
	for _, n := range snap.Needs {
		out = append(out, toAPINeedView(n))
	}
	writeJSON(w, http.StatusOK, api.NeedsResponse{
		ShardID:             shardID,
		Cycle:               snap.Cycle,
		ComputedAtUnixNanos: snap.ComputedAtUnixNanos,
		TotalNeeds:          snap.TotalNeeds,
		Needs:               out,
		QueriedAt:           time.Now().UTC(),
	})
}

func toAPINeedView(n shardclient.NeedView) api.NeedView {
	v := api.NeedView{
		ClusterID:                 n.ClusterID,
		Priority:                  int(n.Priority),
		AggregateResources:        n.AggregateResources,
		MinUnit:                   n.MinUnit,
		Group:                     n.Group,
		Spread:                    spreadToAPI(n.Spread),
		Requirements:              requirementsToAPI(n.Requirements),
		InterruptionPenaltyBucket: n.InterruptionPenaltyBucket,
		ReclamationPenaltyBucket:  n.ReclamationPenaltyBucket,
		Satisfied:                 n.Satisfied,
		ResidualDeficit:           n.ResidualDeficit,
		ClaimedMachineCount:       int(n.ClaimedMachineCount),
		BootstrapCount:            int(n.BootstrapCount),
		ProvisionCount:            int(n.ProvisionCount),
		SameDomain:                n.SameDomain,
		SameSatisfiable:           n.SameSatisfiable,
		AcquisitionParked:         n.AcquisitionParked,
		ParkedAgeCycles:           int(n.ParkedAgeCycles),
		AgeCyclesUnmet:            int(n.AgeCyclesUnmet),
		UnmetReason:               n.UnmetReason,
		ArrivalUnixNanos:          n.ArrivalUnixNanos,
		ProfileFingerprint:        n.ProfileFingerprint,
	}
	if ms := n.MatchingSupply; ms != nil {
		v.MatchingSupply = &api.MatchingSupply{
			Idle:        int(ms.Idle),
			Configured:  int(ms.Configured),
			Speculative: int(ms.Speculative),
			Capped:      ms.Capped,
		}
	}
	if p := n.Preemption; p != nil {
		v.Preemption = &api.PreemptionSummary{VictimsFound: int(p.VictimsFound), CapacityFreed: p.CapacityFreed}
	}
	for _, c := range n.SameCandidates {
		v.SameCandidates = append(v.SameCandidates, api.DomainCoverage{
			Domain:           c.Domain,
			CoveragePerMille: int(c.CoveragePerMille),
			Satisfiable:      c.Satisfiable,
		})
	}
	return v
}

func requirementsToAPI(rs []shardclient.Requirement) []api.Requirement {
	if len(rs) == 0 {
		return nil
	}
	out := make([]api.Requirement, 0, len(rs))
	for _, r := range rs {
		out = append(out, api.Requirement{Key: r.Key, Operator: r.Operator, Values: r.Values})
	}
	return out
}

func spreadToAPI(ss []shardclient.TopologySpread) []api.TopologySpread {
	if len(ss) == 0 {
		return nil
	}
	out := make([]api.TopologySpread, 0, len(ss))
	for _, s := range ss {
		out = append(out, api.TopologySpread{
			TopologyKey:       s.TopologyKey,
			MaxSkew:           int(s.MaxSkew),
			WhenUnsatisfiable: s.WhenUnsatisfiable,
		})
	}
	return out
}
