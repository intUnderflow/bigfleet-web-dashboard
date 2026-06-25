// Package coordclient wraps the leader-only admin RPCs on BigFleet's
// Coordinator service (ADR-0008): ListShards, ListDomainAssignments,
// ListQuotas. The dashboard never calls mutating RPCs — those stay in
// bigfleetctl.
package coordclient

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"

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

func New(addr string) (*Client, error) {
	c := &Client{addr: addr}
	if addr == "" {
		return c, nil
	}
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
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
	ShardID            string
	Address            string
	RegisteredAtUnixNs int64
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

type QuotaAllocation struct {
	Provider string
	Region   string
	PerShard map[string]int32
}

func (c *Client) ListQuotas(ctx context.Context) ([]QuotaAllocation, error) {
	if c.api == nil {
		return nil, ErrNotConfigured
	}
	resp, err := c.api.ListQuotas(ctx, &coordpb.ListQuotasRequest{})
	if err != nil {
		return nil, mapLeaderErr(err)
	}
	out := make([]QuotaAllocation, 0, len(resp.GetAllocations()))
	for _, q := range resp.GetAllocations() {
		out = append(out, QuotaAllocation{
			Provider: q.GetProvider(),
			Region:   q.GetRegion(),
			PerShard: q.GetPerShard(),
		})
	}
	return out, nil
}

func mapLeaderErr(err error) error {
	if s, ok := status.FromError(err); ok && s.Code() == codes.FailedPrecondition {
		return ErrNotLeader
	}
	return err
}
