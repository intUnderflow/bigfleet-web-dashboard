package server

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("GET /api/health", s.healthHandler)
	s.mux.HandleFunc("GET /api/config", s.configHandler)
	s.mux.HandleFunc("GET /api/fleet/overview", s.fleetOverviewHandler)
	s.mux.HandleFunc("GET /api/fleet/actions", s.fleetActionsHandler)
	s.mux.HandleFunc("GET /api/shards", s.shardsListHandler)
	s.mux.HandleFunc("GET /api/shards/{pod}", s.shardDetailHandler)
	s.mux.HandleFunc("GET /api/clusters", s.clustersListHandler)
	s.mux.HandleFunc("GET /api/clusters/{id}", s.clusterDetailHandler)
	s.mux.HandleFunc("GET /api/topology", s.topologyHandler)
	s.mux.HandleFunc("GET /api/providers", s.providersHandler)
	s.mux.HandleFunc("GET /api/shard-reports", s.shardReportsHandler)
	s.mux.HandleFunc("GET /api/needs", s.needsHandler)
	s.mux.HandleFunc("GET /api/finops/snapshot", s.finopsHandler)
	s.mux.Handle("/", s.spaHandler())
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
