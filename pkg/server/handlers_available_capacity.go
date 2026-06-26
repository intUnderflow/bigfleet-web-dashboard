package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// availableCapacityHandler serves /api/available-capacity — the
// AvailableCapacity CR hints across every managed cluster, grouped by
// cluster. Per-cluster reads run concurrently (bounded) and are
// error-isolated: one cluster's failure surfaces inline, the rest render.
func (s *Server) availableCapacityHandler(w http.ResponseWriter, r *http.Request) {
	if !s.kube.Configured() {
		writeError(w, http.StatusServiceUnavailable, "kubeconfig not configured: pass --kubeconfig")
		return
	}
	overallCtx, cancel := context.WithTimeout(r.Context(), clustersListOverallTimeout)
	defer cancel()

	names := s.kube.Clusters()
	out := make([]api.AvailableCapacityCluster, len(names))

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

			out[i] = api.AvailableCapacityCluster{ID: name}
			items, err := s.kube.ListAvailableCapacity(ctx, name)
			if err != nil {
				msg := err.Error()
				out[i].Error = &msg
				return
			}
			out[i].Items = make([]api.AvailableCapacityItem, 0, len(items))
			for _, it := range items {
				out[i].Items = append(out[i].Items, api.AvailableCapacityItem{
					Name:           it.Name,
					Resources:      it.Resources,
					AvailableCount: it.AvailableCount,
					Availability:   it.Availability,
					Cost:           it.Cost,
					Requirements:   it.Requirements,
				})
			}
		}(i, name)
	}
	wg.Wait()

	writeJSON(w, http.StatusOK, api.AvailableCapacityResponse{
		Clusters:  out,
		QueriedAt: time.Now().UTC(),
	})
}
