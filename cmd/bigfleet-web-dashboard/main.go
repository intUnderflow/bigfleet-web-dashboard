package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/intUnderflow/bigfleet/pkg/grpcutil"

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
	// ADR-0048 mTLS flags used to dial the coordinator. Set all three to
	// present the dashboard's bigfleet://readonly certificate (ADR-0060);
	// leave them unset to dial plaintext.
	var tlsCfg grpcutil.TLSConfig
	tlsCfg.RegisterFlags(flag.CommandLine)
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	srv, err := server.New(server.Config{
		Listen:          *listen,
		PrometheusURL:   *promURL,
		CoordinatorAddr: *coordAddr,
		Kubeconfig:      *kubeconfig,
		GrafanaURL:      *grafanaURL,
		TLS:             tlsCfg,
		Logger:          logger,
	})
	if err != nil {
		logger.Error("server init failed", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)

	logger.Info("bigfleet-web-dashboard starting", "listen", *listen)
	// Not deferred: os.Exit below would skip a deferred cancel. Stop
	// listening for signals as soon as Run returns, then exit.
	err = srv.Run(ctx)
	cancel()
	if err != nil {
		logger.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}
