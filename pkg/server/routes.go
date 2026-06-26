package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sort"
	"strings"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

func (s *Server) registerRoutes() {
	for pattern, h := range s.apiHandlers() {
		method, path, _ := strings.Cut(pattern, " ")
		// Dual-mount every route: the bare /api prefix is what the bundled
		// SPA calls; /api/v1 is the frozen external contract (docs/api.md,
		// v1.0). External operator tooling should depend on /api/v1.
		s.mux.HandleFunc(method+" /api"+path, h)
		s.mux.HandleFunc(method+" /api/v1"+path, h)
	}
	s.mux.Handle("/", s.spaHandler())
}

// apiHandlers is the v1 read surface: "METHOD /suffix" → handler. It is the
// single source of truth for the route table; registerRoutes mounts each entry
// under both /api and /api/v1, and the conformance test
// (handlers_conformance_test.go) drives every entry against a fixture so the
// frozen contract can't silently drift.
func (s *Server) apiHandlers() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"GET /health":              s.healthHandler,
		"GET /config":              s.configHandler,
		"GET /fleet/overview":      s.fleetOverviewHandler,
		"GET /fleet/actions":       s.fleetActionsHandler,
		"GET /shards":              s.shardsListHandler,
		"GET /shards/{pod}":        s.shardDetailHandler,
		"GET /shards/{pod}/trends": s.shardTrendsHandler,
		"GET /clusters":            s.clustersListHandler,
		"GET /clusters/{id}":       s.clusterDetailHandler,
		"GET /available-capacity":  s.availableCapacityHandler,
		"GET /topology":            s.topologyHandler,
		"GET /shard-reports":       s.shardReportsHandler,
		"GET /needs":               s.needsHandler,
		"GET /finops/snapshot":     s.finopsHandler,
	}
}

// Handler exposes the route mux for out-of-package harnesses (the substrate-
// gated e2e suite) that drive the surface in-process against a real fleet.
func (s *Server) Handler() http.Handler { return s.mux }

// APIRoutePatterns returns the v1 route patterns ("METHOD /suffix"), sorted, so
// an out-of-package harness can enumerate the whole surface without re-stating
// it (and stay in lockstep with apiHandlers).
func (s *Server) APIRoutePatterns() []string {
	h := s.apiHandlers()
	out := make([]string, 0, len(h))
	for p := range h {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func (s *Server) healthHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, api.HealthResponse{Status: "ok"})
}

func (s *Server) configHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, api.ClientConfig{
		GrafanaURL:       s.cfg.GrafanaURL,
		PrometheusWired:  s.cfg.PrometheusURL != "",
		CoordinatorWired: s.cfg.CoordinatorAddr != "",
		KubeconfigWired:  s.cfg.Kubeconfig != "",
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// Headers are already on the wire so we can't downgrade the status,
		// but at least surface this in the server log — this is exactly the
		// class of bug (NaN-from-Prometheus) that shipped silently the first
		// two times: 200 OK with an empty body, "Unexpected end of JSON"
		// on the client.
		slog.Error("json encode failed", "status", status, "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, api.ErrorResponse{Error: msg})
}
