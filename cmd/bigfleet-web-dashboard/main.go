package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/server"
)

func main() {
	var (
		listen     = flag.String("listen", ":8080", "address to listen on for the HTTP API + SPA")
		promURL    = flag.String("prometheus-url", "", "Prometheus HTTP API base URL (e.g. http://prometheus:9090)")
		coordAddr  = flag.String("coordinator-addr", "", "BigFleet coordinator gRPC address (e.g. bigfleet-coordinator:7790)")
		kubeconfig = flag.String("kubeconfig", "", "path to kubeconfig for managed clusters")
		grafanaURL = flag.String("grafana-url", "", "Grafana base URL used by embedded-panel iframes")
	)
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	srv, err := server.New(server.Config{
		Listen:          *listen,
		PrometheusURL:   *promURL,
		CoordinatorAddr: *coordAddr,
		Kubeconfig:      *kubeconfig,
		GrafanaURL:      *grafanaURL,
		Logger:          logger,
	})
	if err != nil {
		logger.Error("server init failed", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	logger.Info("bigfleet-web-dashboard starting", "listen", *listen)
	if err := srv.Run(ctx); err != nil {
		logger.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}
