// Package shardclient dials a shard's ShardRead service (ADR-0061) to read
// its per-Need last-cycle verdicts. The dashboard discovers shard addresses
// from the coordinator's ListShards and dials each shard directly, with the
// same bigfleet://readonly certificate it uses for the coordinator.
package shardclient

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"google.golang.org/grpc"

	"github.com/intUnderflow/bigfleet/pkg/grpcutil"
	pb "github.com/intUnderflow/bigfleet/pkg/proto/bigfleet/v1alpha1"
)

// NeedView is the read-side projection of one Need's last-cycle verdict.
type NeedView struct {
	ClusterID                 string
	Priority                  int32
	AggregateResources        map[string]string
	MinUnit                   map[string]string
	Group                     string
	Requirements              []string
	InterruptionPenaltyBucket string
	ReclamationPenaltyBucket  string
	Satisfied                 bool
	ResidualDeficit           map[string]string
	ClaimedMachineCount       int32
	BootstrapCount            int32
	ProvisionCount            int32
	SameDomain                string
	SameSatisfiable           bool
	AcquisitionParked         bool
	AgeCyclesUnmet            int32
	UnmetReason               string
}

// NeedsSnapshot is one shard's InspectNeeds response.
type NeedsSnapshot struct {
	Cycle               int64
	ComputedAtUnixNanos int64
	TotalNeeds          int
	Needs               []NeedView
}

// Client dials shards with the dashboard's TLS config (the bigfleet://readonly
// cert, or plaintext when unset).
type Client struct {
	tls grpcutil.TLSConfig
}

// New returns a shard client that dials with the given TLS config.
func New(tls grpcutil.TLSConfig) *Client { return &Client{tls: tls} }

// InspectNeeds dials the shard at addr and streams its needs snapshot,
// optionally filtered to one cluster and capped at limit (0 = no cap).
func (c *Client) InspectNeeds(ctx context.Context, addr, cluster string, limit int) (NeedsSnapshot, error) {
	if addr == "" {
		return NeedsSnapshot{}, errors.New("shardclient: empty shard address")
	}
	dialOpts, err := c.tls.DialOptions()
	if err != nil {
		return NeedsSnapshot{}, fmt.Errorf("shardclient: dial options: %w", err)
	}
	conn, err := grpc.NewClient(addr, dialOpts...)
	if err != nil {
		return NeedsSnapshot{}, fmt.Errorf("shardclient: dial %s: %w", addr, err)
	}
	defer func() { _ = conn.Close() }()

	stream, err := pb.NewShardReadClient(conn).InspectNeeds(ctx, &pb.InspectNeedsRequest{
		ClusterId: cluster,
		Limit:     int32(limit),
	})
	if err != nil {
		return NeedsSnapshot{}, fmt.Errorf("shardclient: inspect needs: %w", err)
	}

	var snap NeedsSnapshot
	for {
		msg, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return NeedsSnapshot{}, fmt.Errorf("shardclient: recv: %w", err)
		}
		if h := msg.GetHeader(); h != nil {
			snap.Cycle = h.GetCycle()
			snap.ComputedAtUnixNanos = h.GetComputedAtUnixNanos()
			snap.TotalNeeds = int(h.GetTotalNeeds())
			continue
		}
		if nv := msg.GetNeed(); nv != nil {
			snap.Needs = append(snap.Needs, fromProto(nv))
		}
	}
	return snap, nil
}

func fromProto(nv *pb.NeedView) NeedView {
	n := nv.GetNeed()
	out := NeedView{
		ClusterID:                 nv.GetClusterId(),
		Priority:                  n.GetPriority(),
		AggregateResources:        n.GetAggregateResources(),
		MinUnit:                   n.GetMinUnit(),
		Group:                     n.GetGroup(),
		Requirements:              formatRequirements(n.GetRequirements()),
		InterruptionPenaltyBucket: shortBucket(n.GetInterruptionPenaltyBucket()),
		ReclamationPenaltyBucket:  shortBucket(n.GetReclamationPenaltyBucket()),
		Satisfied:                 nv.GetSatisfied(),
		ClaimedMachineCount:       nv.GetClaimedMachineCount(),
		BootstrapCount:            nv.GetBootstrapCount(),
		ProvisionCount:            nv.GetProvisionCount(),
		SameDomain:                nv.GetSameDomain(),
		SameSatisfiable:           nv.GetSameSatisfiable(),
		AcquisitionParked:         nv.GetAcquisitionParked(),
		AgeCyclesUnmet:            nv.GetAgeCyclesUnmet(),
		UnmetReason:               strings.TrimPrefix(nv.GetUnmetReason().String(), "UNMET_REASON_"),
	}
	if d := nv.GetResidualDeficit(); d != nil {
		out.ResidualDeficit = d.GetResources()
	}
	return out
}

func formatRequirements(rs []*pb.NodeSelectorRequirement) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		op := strings.TrimPrefix(r.GetOperator().String(), "OPERATOR_")
		if vals := r.GetValues(); len(vals) > 0 {
			out = append(out, fmt.Sprintf("%s %s [%s]", r.GetKey(), op, strings.Join(vals, ",")))
		} else {
			out = append(out, fmt.Sprintf("%s %s", r.GetKey(), op))
		}
	}
	return out
}

// shortBucket renders a PenaltyBucket as its short label (e.g. "8192",
// "PINNED", "ZERO"), dropping the PENALTY_BUCKET_ prefix.
func shortBucket(b pb.PenaltyBucket) string {
	return strings.TrimPrefix(b.String(), "PENALTY_BUCKET_")
}
