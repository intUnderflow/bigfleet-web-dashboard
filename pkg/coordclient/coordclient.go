// Package coordclient wraps the leader-only READ RPCs on BigFleet's
// Coordinator service: ListShards, ListDomainAssignments, ListQuotas,
// ListProviders, ListShardReports. The dashboard never calls mutating
// RPCs — those stay in bigfleetctl.
//
// Under ADR-0048 the coordinator may require mTLS; under ADR-0060 these
// read RPCs accept a bigfleet://readonly (or bigfleet://admin) client
// certificate. The dashboard should present a bigfleet://readonly cert so
// it physically cannot mutate the fleet. With no TLS flags set the client
// dials plaintext (the coordinator's trust-the-network default).
package coordclient

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/intUnderflow/bigfleet/pkg/grpcutil"
	coordpb "github.com/intUnderflow/bigfleet/pkg/proto/bigfleet/v1alpha1"
)

var (
	ErrNotConfigured = errors.New("coordinator client not configured: pass --coordinator-addr")
	ErrNotLeader     = errors.New("coordinator replica is not the Raft leader")
)

type Client struct {
	addr string
	conn *grpc.ClientConn
	api  coordpb.CoordinatorClient
}

// New dials the coordinator at addr using the given TLS config (ADR-0048).
// A zero TLSConfig dials plaintext; a full one presents the dashboard's
// client certificate — which should carry the bigfleet://readonly URI SAN
// (ADR-0060). An empty addr yields an unconfigured client whose read
// methods return ErrNotConfigured.
func New(addr string, tlsCfg grpcutil.TLSConfig) (*Client, error) {
	c := &Client{addr: addr}
	if addr == "" {
		return c, nil
	}
	dialOpts, err := tlsCfg.DialOptions()
	if err != nil {
		return nil, fmt.Errorf("coordinator dial options: %w", err)
	}
	conn, err := grpc.NewClient(addr, dialOpts...)
	if err != nil {
		return nil, fmt.Errorf("dial coordinator: %w", err)
	}
	c.conn = conn
	c.api = coordpb.NewCoordinatorClient(conn)
	return c, nil
}

func (c *Client) Configured() bool { return c.addr != "" }
func (c *Client) Addr() string     { return c.addr }

func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

type ShardRegistryEntry struct {
	ShardID             string
	Address             string
	RegisteredAtUnixNs  int64
	LastHeartbeatUnixNs int64
}

func (c *Client) ListShards(ctx context.Context) ([]ShardRegistryEntry, error) {
	if c.api == nil {
		return nil, ErrNotConfigured
	}
	resp, err := c.api.ListShards(ctx, &coordpb.ListShardsRequest{})
	if err != nil {
		return nil, mapLeaderErr(err)
	}
	out := make([]ShardRegistryEntry, 0, len(resp.GetShards()))
	for _, s := range resp.GetShards() {
		out = append(out, ShardRegistryEntry{
			ShardID:             s.GetShardId(),
			Address:             s.GetAddress(),
			RegisteredAtUnixNs:  s.GetRegisteredAtUnixNs(),
			LastHeartbeatUnixNs: s.GetLastHeartbeatUnixNs(),
		})
	}
	return out, nil
}

type DomainAssignment struct {
	TopologyKey   string
	TopologyValue string
	ShardID       string
}

func (c *Client) ListDomainAssignments(ctx context.Context) ([]DomainAssignment, error) {
	if c.api == nil {
		return nil, ErrNotConfigured
	}
	resp, err := c.api.ListDomainAssignments(ctx, &coordpb.ListDomainAssignmentsRequest{})
	if err != nil {
		return nil, mapLeaderErr(err)
	}
	out := make([]DomainAssignment, 0, len(resp.GetAssignments()))
	for _, a := range resp.GetAssignments() {
		out = append(out, DomainAssignment{
			TopologyKey:   a.GetTopologyKey(),
			TopologyValue: a.GetTopologyValue(),
			ShardID:       a.GetShardId(),
		})
	}
	return out, nil
}

// ShardReportSummary is the inventory headline from a shard's last report.
type ShardReportSummary struct {
	TotalMachines      int32
	FreeMachines       int32
	InstanceTypeCounts map[string]int32
	ZoneCounts         map[string]int32
	// ProviderAddress is the out-of-tree provider the shard is bound to
	// (its --provider-addr); empty = the in-process fake (not deployed).
	ProviderAddress string
}

// ShardReportShortfall is one unsatisfied need the shard reported. The
// coordinator's soft state does not retain the original requirements
// (ADR-0060) — only the fields below.
type ShardReportShortfall struct {
	Priority      int32
	Deficit       map[string]string
	AgeCycles     int32
	PenaltyBucket string
}

// ShardReport is the coordinator's leader-local soft-state snapshot of one
// shard (ADR-0060 ListShardReports): its latest summary + outstanding
// shortfalls. Leader-local and stale-on-failover — ReceivedAtUnixNs lets the
// caller judge freshness; an empty result means "rebuilding after failover",
// not "zero demand".
type ShardReport struct {
	ShardID          string
	Cycle            int64
	ReceivedAtUnixNs int64
	Summary          *ShardReportSummary
	Shortfalls       []ShardReportShortfall
}

// ListShardReports returns the coordinator's soft-state snapshot for every
// shard it currently holds a report for. Pass shardID to restrict to one
// shard; empty returns all.
func (c *Client) ListShardReports(ctx context.Context, shardID string) ([]ShardReport, error) {
	if c.api == nil {
		return nil, ErrNotConfigured
	}
	resp, err := c.api.ListShardReports(ctx, &coordpb.ListShardReportsRequest{ShardId: shardID})
	if err != nil {
		return nil, mapLeaderErr(err)
	}
	out := make([]ShardReport, 0, len(resp.GetReports()))
	for _, r := range resp.GetReports() {
		rep := ShardReport{
			ShardID:          r.GetShardId(),
			Cycle:            r.GetCycle(),
			ReceivedAtUnixNs: r.GetReceivedAtUnixNs(),
		}
		if s := r.GetSummary(); s != nil {
			rep.Summary = &ShardReportSummary{
				TotalMachines:      s.GetTotalMachines(),
				FreeMachines:       s.GetFreeMachines(),
				InstanceTypeCounts: s.GetPerInstanceTypeCounts(),
				ZoneCounts:         s.GetPerZoneCounts(),
				ProviderAddress:    s.GetProviderAddress(),
			}
		}
		rep.Shortfalls = make([]ShardReportShortfall, 0, len(r.GetShortfalls()))
		for _, sf := range r.GetShortfalls() {
			rep.Shortfalls = append(rep.Shortfalls, ShardReportShortfall{
				Priority:      sf.GetPriority(),
				Deficit:       sf.GetDeficit().GetResources(),
				AgeCycles:     sf.GetAgeCycles(),
				PenaltyBucket: sf.GetInterruptionPenaltyBucket().String(),
			})
		}
		out = append(out, rep)
	}
	return out, nil
}

func mapLeaderErr(err error) error {
	if s, ok := status.FromError(err); ok && s.Code() == codes.FailedPrecondition {
		return ErrNotLeader
	}
	return err
}
