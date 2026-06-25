package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
)

const (
	queryRaftTerm            = `max(bigfleet_coordinator_raft_term)`
	queryApplySuccessRate    = `sum(rate(bigfleet_coordinator_apply_total{outcome="success"}[5m]))`
	queryApplyErrorRate      = `sum(rate(bigfleet_coordinator_apply_total{outcome="error"}[5m]))`
	queryPendingInstructions = `bigfleet_coordinator_pending_instructions`
)

func (s *Server) topologyHandler(w http.ResponseWriter, r *http.Request) {
	if !s.coord.Configured() {
		writeError(w, http.StatusServiceUnavailable, "coordinator not configured: pass --coordinator-addr")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	shards, err := s.coord.ListShards(ctx)
	if err != nil {
		writeError(w, statusFromCoordErr(err), "coordinator ListShards: "+err.Error())
		return
	}
	domains, err := s.coord.ListDomainAssignments(ctx)
	if err != nil {
		writeError(w, statusFromCoordErr(err), "coordinator ListDomainAssignments: "+err.Error())
		return
	}
	quotas, err := s.coord.ListQuotas(ctx)
	if err != nil {
		writeError(w, statusFromCoordErr(err), "coordinator ListQuotas: "+err.Error())
		return
	}

	var warnings []string
	pendingByShard := map[string]float64{}
	health := api.CoordinatorHealth{}

	if s.prom.Configured() {
		now := time.Now()
		if v, err := s.prom.QueryScalar(ctx, queryRaftTerm, now); err == nil {
			health.RaftTerm = int(v)
		} else {
			warnings = append(warnings, "prometheus query (raft term): "+err.Error())
		}
		if v, err := s.prom.QueryScalar(ctx, queryApplySuccessRate, now); err == nil {
			health.ApplyRatePerSec = v
		} else {
			warnings = append(warnings, "prometheus query (apply rate): "+err.Error())
		}
		if v, err := s.prom.QueryScalar(ctx, queryApplyErrorRate, now); err == nil {
			health.ApplyErrorRatePerSec = v
		} else {
			warnings = append(warnings, "prometheus query (apply error rate): "+err.Error())
		}
		if m, err := s.prom.QueryByLabel(ctx, queryPendingInstructions, "shard", now); err == nil {
			pendingByShard = m
			for _, v := range m {
				health.PendingInstructionsTotal += int(v)
			}
		} else {
			warnings = append(warnings, "prometheus query (pending instructions): "+err.Error())
		}
	} else {
		warnings = append(warnings, "prometheus not configured — coordinator metrics unavailable")
	}

	apiShards := make([]api.TopologyShard, 0, len(shards))
	for _, sd := range shards {
		apiShards = append(apiShards, api.TopologyShard{
			ShardID:              sd.ShardID,
			Address:              sd.Address,
			RegisteredAtUnixSec:  sd.RegisteredAtUnixNs / 1e9,
			LastHeartbeatUnixSec: sd.LastHeartbeatUnixNs / 1e9,
			PendingInstructions:  int(pendingByShard[sd.ShardID]),
		})
	}

	apiDomains := make([]api.TopologyDomainAssignment, 0, len(domains))
	for _, d := range domains {
		apiDomains = append(apiDomains, api.TopologyDomainAssignment{
			TopologyKey:   d.TopologyKey,
			TopologyValue: d.TopologyValue,
			ShardID:       d.ShardID,
		})
	}

	apiQuotas := make([]api.TopologyQuota, 0, len(quotas))
	for _, q := range quotas {
		perShard := make(map[string]int, len(q.PerShard))
		for k, v := range q.PerShard {
			perShard[k] = int(v)
		}
		apiQuotas = append(apiQuotas, api.TopologyQuota{
			Provider: q.Provider,
			Region:   q.Region,
			PerShard: perShard,
		})
	}

	writeJSON(w, http.StatusOK, api.Topology{
		Coordinator:       health,
		Shards:            apiShards,
		DomainAssignments: apiDomains,
		Quotas:            apiQuotas,
		Warnings:          warnings,
		QueriedAt:         time.Now().UTC(),
	})
}

func statusFromCoordErr(err error) int {
	if errors.Is(err, coordclient.ErrNotLeader) {
		return http.StatusServiceUnavailable
	}
	if errors.Is(err, coordclient.ErrNotConfigured) {
		return http.StatusServiceUnavailable
	}
	return http.StatusBadGateway
}
