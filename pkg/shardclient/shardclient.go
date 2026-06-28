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
//
// A Need is not an atom: it is the collapse of every unschedulable pod/CR
// whose aggregation key — (Requirements, Priority, Spread, the two penalty
// buckets) — matches (ADR-0027). We project that whole key, not a thin
// subset, so the dashboard can explain *how* the roll-up formed this Need.
type NeedView struct {
	ClusterID                 string
	Priority                  int32
	AggregateResources        map[string]string
	MinUnit                   map[string]string
	Group                     string
	Requirements              []Requirement
	Spread                    []TopologySpread
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
	ParkedAgeCycles           int32
	AgeCyclesUnmet            int32
	UnmetReason               string
	ArrivalUnixNanos          int64  // NeedsTable secondary sort key (priority desc, arrival asc)
	ProfileFingerprint        string // aggregation-profile identity; cohort + cross-link join key

	// ADR-0061 amendment decision context (observation-only):
	MatchingSupply *MatchingSupply    // per-state matching cardinality (unsatisfied only)
	Preemption     *PreemptionSummary // Phase 2 victim summary (PREEMPTION_EXHAUSTED only)
	SameCandidates []DomainCoverage   // top-K candidate-domain coverage (Same Needs)
}

// Requirement is one node-selector term of the aggregation key, kept
// structured (key/operator/values) so the protobuf-only Same operator — the
// signal that makes a gang a gang — survives to the UI rather than being
// flattened into a lossy string.
type Requirement struct {
	Key      string
	Operator string // In, NotIn, Exists, DoesNotExist, Same
	Values   []string
}

// TopologySpread is a spread term of the aggregation key (one of the five
// fields CRs must match to collapse into a Need). Dropped by the old
// projection; surfaced now because it is decision context, not decoration.
type TopologySpread struct {
	TopologyKey       string
	MaxSkew           int32
	WhenUnsatisfiable string // DoNotSchedule, ScheduleAnyway
}

// MatchingSupply is the per-state count of machines matching an unsatisfied
// Need's shape; Capped is true if any state hit the engine's count cap.
type MatchingSupply struct {
	Idle        int32
	Configured  int32
	Speculative int32
	Capped      bool
}

// PreemptionSummary is Phase 2's preemption attempt for a still-unmet Need.
type PreemptionSummary struct {
	VictimsFound  int32
	CapacityFreed map[string]string
}

// DomainCoverage is one candidate topology domain the Same pre-pass weighed.
type DomainCoverage struct {
	Domain           string
	CoveragePerMille int32
	Satisfiable      bool
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
		Requirements:              fromProtoRequirements(n.GetRequirements()),
		Spread:                    fromProtoSpread(n.GetSpread()),
		InterruptionPenaltyBucket: shortBucket(n.GetInterruptionPenaltyBucket()),
		ReclamationPenaltyBucket:  shortBucket(n.GetReclamationPenaltyBucket()),
		Satisfied:                 nv.GetSatisfied(),
		ClaimedMachineCount:       nv.GetClaimedMachineCount(),
		BootstrapCount:            nv.GetBootstrapCount(),
		ProvisionCount:            nv.GetProvisionCount(),
		SameDomain:                nv.GetSameDomain(),
		SameSatisfiable:           nv.GetSameSatisfiable(),
		AcquisitionParked:         nv.GetAcquisitionParked(),
		ParkedAgeCycles:           nv.GetParkedAgeCycles(),
		AgeCyclesUnmet:            nv.GetAgeCyclesUnmet(),
		UnmetReason:               strings.TrimPrefix(nv.GetUnmetReason().String(), "UNMET_REASON_"),
		ArrivalUnixNanos:          nv.GetArrivalUnixNanos(),
		ProfileFingerprint:        nv.GetProfileFingerprint(),
	}
	if d := nv.GetResidualDeficit(); d != nil {
		out.ResidualDeficit = d.GetResources()
	}
	// ADR-0061 amendment decision context.
	if ms := nv.GetMatchingSupply(); ms != nil {
		out.MatchingSupply = &MatchingSupply{
			Idle:        ms.GetIdle(),
			Configured:  ms.GetConfigured(),
			Speculative: ms.GetSpeculative(),
			Capped:      ms.GetCapped(),
		}
	}
	if p := nv.GetPreemption(); p != nil {
		out.Preemption = &PreemptionSummary{
			VictimsFound:  p.GetVictimsFound(),
			CapacityFreed: p.GetCapacityFreed().GetResources(),
		}
	}
	for _, c := range nv.GetSameCandidates() {
		out.SameCandidates = append(out.SameCandidates, DomainCoverage{
			Domain:           c.GetDomain(),
			CoveragePerMille: c.GetCoveragePerMille(),
			Satisfiable:      c.GetSatisfiable(),
		})
	}
	return out
}

// fromProtoRequirements keeps each term structured (key/operator/values) so
// the Same operator survives; titleOperator renders the enum as In/NotIn/
// Exists/DoesNotExist/Same.
func fromProtoRequirements(rs []*pb.NodeSelectorRequirement) []Requirement {
	if len(rs) == 0 {
		return nil
	}
	out := make([]Requirement, 0, len(rs))
	for _, r := range rs {
		out = append(out, Requirement{
			Key:      r.GetKey(),
			Operator: titleOperator(r.GetOperator()),
			Values:   r.GetValues(),
		})
	}
	return out
}

func fromProtoSpread(ss []*pb.TopologySpread) []TopologySpread {
	if len(ss) == 0 {
		return nil
	}
	out := make([]TopologySpread, 0, len(ss))
	for _, s := range ss {
		out = append(out, TopologySpread{
			TopologyKey:       s.GetTopologyKey(),
			MaxSkew:           s.GetMaxSkew(),
			WhenUnsatisfiable: titleWhenUnsatisfiable(s.GetWhenUnsatisfiable()),
		})
	}
	return out
}

// titleOperator maps the NodeSelector operator enum to a compact CamelCase
// label (OPERATOR_NOT_IN → "NotIn", OPERATOR_SAME → "Same").
func titleOperator(op pb.NodeSelectorRequirement_Operator) string {
	switch op {
	case pb.NodeSelectorRequirement_OPERATOR_IN:
		return "In"
	case pb.NodeSelectorRequirement_OPERATOR_NOT_IN:
		return "NotIn"
	case pb.NodeSelectorRequirement_OPERATOR_EXISTS:
		return "Exists"
	case pb.NodeSelectorRequirement_OPERATOR_DOES_NOT_EXIST:
		return "DoesNotExist"
	case pb.NodeSelectorRequirement_OPERATOR_SAME:
		return "Same"
	default:
		return strings.TrimPrefix(op.String(), "OPERATOR_")
	}
}

func titleWhenUnsatisfiable(w pb.TopologySpread_WhenUnsatisfiable) string {
	switch w {
	case pb.TopologySpread_WHEN_UNSATISFIABLE_DO_NOT_SCHEDULE:
		return "DoNotSchedule"
	case pb.TopologySpread_WHEN_UNSATISFIABLE_SCHEDULE_ANYWAY:
		return "ScheduleAnyway"
	default:
		return strings.TrimPrefix(w.String(), "WHEN_UNSATISFIABLE_")
	}
}

// shortBucket renders a PenaltyBucket as its short label (e.g. "8192",
// "PINNED", "ZERO"), dropping the PENALTY_BUCKET_ prefix.
func shortBucket(b pb.PenaltyBucket) string {
	return strings.TrimPrefix(b.String(), "PENALTY_BUCKET_")
}
