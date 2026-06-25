package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

const (
	// Per-cluster LIST can take several seconds against a kine-backed
	// apiserver with tens of thousands of CRs (kwok-laptop demo: ~25K CRs
	// per cluster, ~20s each). Concurrency caps at 5 because piling more
	// concurrent LISTs onto one kine sqlite WAL just thrashes — fewer
	// in-flight finishes the page faster overall.
	clustersListPerCallTimeout = 30 * time.Second
	clustersListOverallTimeout = 60 * time.Second
	clustersListConcurrency    = 5
	clusterDetailTimeout       = 30 * time.Second
)

func (s *Server) clustersListHandler(w http.ResponseWriter, r *http.Request) {
	if !s.kube.Configured() {
		writeError(w, http.StatusServiceUnavailable, "kubeconfig not configured: pass --kubeconfig")
		return
	}
	overallCtx, cancel := context.WithTimeout(r.Context(), clustersListOverallTimeout)
	defer cancel()

	names := s.kube.Clusters()
	out := make([]api.ClusterSummary, len(names))

	sem := make(chan struct{}, clustersListConcurrency)
	var wg sync.WaitGroup
	for i, name := range names {
		wg.Add(1)
		go func(i int, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			ctx, cancel := context.WithTimeout(overallCtx, clustersListPerCallTimeout)
			defer cancel()
			out[i] = api.ClusterSummary{ID: name}
			if crs, err := s.kube.CountCapacityRequestsByPhase(ctx, name); err == nil {
				out[i].CapacityRequests = sumValues(crs)
				out[i].CapacityRequestsPending = crs["Pending"]
			} else {
				msg := err.Error()
				out[i].Error = &msg
			}
			if uns, err := s.kube.CountUpcomingNodesByPhase(ctx, name); err == nil {
				out[i].UpcomingNodes = sumValues(uns)
			} else if out[i].Error == nil {
				msg := err.Error()
				out[i].Error = &msg
			}
		}(i, name)
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, api.ClustersList{
		Clusters:  out,
		QueriedAt: time.Now().UTC(),
	})
}

func (s *Server) clusterDetailHandler(w http.ResponseWriter, r *http.Request) {
	if !s.kube.Configured() {
		writeError(w, http.StatusServiceUnavailable, "kubeconfig not configured: pass --kubeconfig")
		return
	}
	cluster := r.PathValue("id")
	if !clusterIDKnown(s.kube, cluster) {
		writeError(w, http.StatusNotFound, "unknown cluster")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), clusterDetailTimeout)
	defer cancel()

	crByPhase, err := s.kube.CountCapacityRequestsByPhase(ctx, cluster)
	if err != nil {
		writeError(w, http.StatusBadGateway, "list capacityrequests: "+err.Error())
		return
	}
	unByPhase, err := s.kube.CountUpcomingNodesByPhase(ctx, cluster)
	if err != nil {
		writeError(w, http.StatusBadGateway, "list upcomingnodes: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, api.ClusterDetail{
		ID:                      cluster,
		CapacityRequestsByPhase: crByPhase,
		CapacityRequestsTotal:   sumValues(crByPhase),
		UpcomingNodesByPhase:    unByPhase,
		UpcomingNodesTotal:      sumValues(unByPhase),
		QueriedAt:               time.Now().UTC(),
	})
}

func clusterIDKnown(k KubeReader, id string) bool {
	for _, c := range k.Clusters() {
		if c == id {
			return true
		}
	}
	return false
}

func sumValues(m map[string]int) int {
	total := 0
	for _, v := range m {
		total += v
	}
	return total
}
