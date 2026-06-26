package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/intUnderflow/bigfleet/pkg/grpcutil"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/coordclient"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/kubeclient"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/promclient"
	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/shardclient"
)

// KubeReader is the subset of the kube client the HTTP handlers depend on.
// Defined here so handler tests can substitute a stub without touching the
// real kubeconfig / apiserver plumbing.
type KubeReader interface {
	Configured() bool
	Clusters() []string
	CountCapacityRequestsByPhase(ctx context.Context, cluster string) (map[string]int, error)
	CountUpcomingNodesByPhase(ctx context.Context, cluster string) (map[string]int, error)
	ListAvailableCapacity(ctx context.Context, cluster string) ([]kubeclient.AvailableCapacity, error)
}

// CoordReader is the subset of the coordinator gRPC client the HTTP handlers
// depend on. Same testability motivation as KubeReader.
type CoordReader interface {
	Configured() bool
	ListShards(ctx context.Context) ([]coordclient.ShardRegistryEntry, error)
	ListDomainAssignments(ctx context.Context) ([]coordclient.DomainAssignment, error)
	ListQuotas(ctx context.Context) ([]coordclient.QuotaAllocation, error)
	ListProviders(ctx context.Context) ([]coordclient.Provider, error)
	ListShardReports(ctx context.Context, shardID string) ([]coordclient.ShardReport, error)
}

// ShardNeedsReader dials a shard's ShardRead.InspectNeeds (ADR-0061). The
// needs handler discovers shard addresses via CoordReader.ListShards and
// reads each shard directly. Interface for test substitution.
type ShardNeedsReader interface {
	InspectNeeds(ctx context.Context, addr, cluster string, limit int) (shardclient.NeedsSnapshot, error)
}

type Config struct {
	Listen          string
	PrometheusURL   string
	CoordinatorAddr string
	Kubeconfig      string
	GrafanaURL      string
	// TLS is the ADR-0048 client TLS config used to dial the coordinator.
	// Zero value = plaintext; a full set presents the dashboard's
	// bigfleet://readonly certificate (ADR-0060).
	TLS    grpcutil.TLSConfig
	Logger *slog.Logger
}

type Server struct {
	cfg        Config
	prom       *promclient.Client
	coord      CoordReader
	kube       KubeReader
	shardNeeds ShardNeedsReader
	mux        *http.ServeMux
	server     *http.Server
}

func New(cfg Config) (*Server, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	// Route package-level slog calls (e.g. writeJSON's encode-error log)
	// to the same handler the server uses, so silent-failure bugs surface
	// in the same log stream as request lines.
	slog.SetDefault(cfg.Logger)
	prom, err := promclient.New(cfg.PrometheusURL)
	if err != nil {
		return nil, err
	}
	coord, err := coordclient.New(cfg.CoordinatorAddr, cfg.TLS)
	if err != nil {
		return nil, err
	}
	kube, err := kubeclient.New(cfg.Kubeconfig)
	if err != nil {
		return nil, err
	}

	s := &Server{
		cfg:        cfg,
		prom:       prom,
		coord:      coord,
		kube:       kube,
		shardNeeds: shardclient.New(cfg.TLS),
		mux:        http.NewServeMux(),
	}
	s.registerRoutes()
	s.server = &http.Server{
		Addr:              cfg.Listen,
		Handler:           s.logMiddleware(s.mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return s, nil
}

func (s *Server) Run(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		err := s.server.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()
	select {
	case <-ctx.Done():
		s.cfg.Logger.Info("shutdown signal received")
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return s.server.Shutdown(shutCtx)
	case err := <-errCh:
		return err
	}
}

func (s *Server) logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		s.cfg.Logger.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"dur_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
