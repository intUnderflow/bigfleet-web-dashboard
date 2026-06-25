package server

import (
	"context"
	"net/http"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// providersHandler serves /api/providers — the provider backends the
// coordinator has registered (ADR-0060 ListProviders).
func (s *Server) providersHandler(w http.ResponseWriter, r *http.Request) {
	if !s.coord.Configured() {
		writeError(w, http.StatusServiceUnavailable, "coordinator not configured: pass --coordinator-addr")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	providers, err := s.coord.ListProviders(ctx)
	if err != nil {
		writeError(w, statusFromCoordErr(err), "coordinator ListProviders: "+err.Error())
		return
	}

	out := make([]api.Provider, 0, len(providers))
	for _, p := range providers {
		out = append(out, api.Provider{Name: p.Name, Address: p.Address, Region: p.Region})
	}
	writeJSON(w, http.StatusOK, api.ProvidersList{Providers: out, QueriedAt: time.Now().UTC()})
}
