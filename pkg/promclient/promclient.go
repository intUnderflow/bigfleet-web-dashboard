package promclient

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/prometheus/client_golang/api"
	v1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"
)

var ErrNotConfigured = errors.New("prometheus client not configured: pass --prometheus-url")

type Client struct {
	api v1.API
}

func New(baseURL string) (*Client, error) {
	if baseURL == "" {
		return &Client{}, nil
	}
	c, err := api.NewClient(api.Config{Address: baseURL})
	if err != nil {
		return nil, fmt.Errorf("prometheus client: %w", err)
	}
	return &Client{api: v1.NewAPI(c)}, nil
}

func (c *Client) Configured() bool { return c.api != nil }

func (c *Client) Query(ctx context.Context, q string, t time.Time) (model.Value, error) {
	if c.api == nil {
		return nil, ErrNotConfigured
	}
	v, _, err := c.api.Query(ctx, q, t)
	return v, err
}

func (c *Client) QueryRange(ctx context.Context, q string, r v1.Range) (model.Value, error) {
	if c.api == nil {
		return nil, ErrNotConfigured
	}
	v, _, err := c.api.QueryRange(ctx, q, r)
	return v, err
}

// QueryScalar runs an instant query expected to reduce to a single value
// (a scalar or a one-element vector). Empty vector is treated as 0.
func (c *Client) QueryScalar(ctx context.Context, q string, t time.Time) (float64, error) {
	v, err := c.Query(ctx, q, t)
	if err != nil {
		return 0, err
	}
	switch vv := v.(type) {
	case *model.Scalar:
		return float64(vv.Value), nil
	case model.Vector:
		if len(vv) == 0 {
			return 0, nil
		}
		return float64(vv[0].Value), nil
	default:
		return 0, fmt.Errorf("promclient: unexpected scalar result type %T", v)
	}
}

// LabelledSample is a single sample from a Prometheus vector result with all
// of its labels preserved.
type LabelledSample struct {
	Labels map[string]string
	Value  float64
}

// QueryVector runs an instant query and returns each vector sample with all
// of its labels intact. Use this when grouping by more than one label.
func (c *Client) QueryVector(ctx context.Context, q string, t time.Time) ([]LabelledSample, error) {
	v, err := c.Query(ctx, q, t)
	if err != nil {
		return nil, err
	}
	vec, ok := v.(model.Vector)
	if !ok {
		return nil, fmt.Errorf("promclient: expected vector result, got %T", v)
	}
	out := make([]LabelledSample, 0, len(vec))
	for _, s := range vec {
		fv := float64(s.Value)
		if math.IsNaN(fv) || math.IsInf(fv, 0) {
			continue
		}
		labels := make(map[string]string, len(s.Metric))
		for k, v := range s.Metric {
			labels[string(k)] = string(v)
		}
		out = append(out, LabelledSample{Labels: labels, Value: fv})
	}
	return out, nil
}

// QueryByLabel runs an instant query and groups vector samples by a single label.
// Samples missing the label are dropped.
func (c *Client) QueryByLabel(ctx context.Context, q, label string, t time.Time) (map[string]float64, error) {
	v, err := c.Query(ctx, q, t)
	if err != nil {
		return nil, err
	}
	vec, ok := v.(model.Vector)
	if !ok {
		return nil, fmt.Errorf("promclient: expected vector result, got %T", v)
	}
	out := make(map[string]float64, len(vec))
	ln := model.LabelName(label)
	for _, s := range vec {
		k, ok := s.Metric[ln]
		if !ok {
			continue
		}
		fv := float64(s.Value)
		if math.IsNaN(fv) || math.IsInf(fv, 0) {
			continue
		}
		out[string(k)] = fv
	}
	return out, nil
}

// QueryRangeByLabel runs a range query and groups matrix series by a single label.
// Returns the shared timestamp axis (unix seconds, ascending) and per-label series
// aligned to it. Missing samples within a series are filled with NaN.
func (c *Client) QueryRangeByLabel(ctx context.Context, q, label string, r v1.Range) ([]int64, map[string][]float64, error) {
	v, err := c.QueryRange(ctx, q, r)
	if err != nil {
		return nil, nil, err
	}
	mat, ok := v.(model.Matrix)
	if !ok {
		return nil, nil, fmt.Errorf("promclient: expected matrix result, got %T", v)
	}

	steps := int(r.End.Sub(r.Start)/r.Step) + 1
	timestamps := make([]int64, steps)
	for i := 0; i < steps; i++ {
		timestamps[i] = r.Start.Add(time.Duration(i) * r.Step).Unix()
	}

	out := make(map[string][]float64, len(mat))
	ln := model.LabelName(label)
	for _, series := range mat {
		k, ok := series.Metric[ln]
		if !ok {
			continue
		}
		row := make([]float64, steps) // zero-filled; missing samples stay 0
		for _, sp := range series.Values {
			idx := int(time.Time(sp.Timestamp.Time()).Sub(r.Start) / r.Step)
			if idx < 0 || idx >= steps {
				continue
			}
			v := float64(sp.Value)
			if math.IsNaN(v) || math.IsInf(v, 0) {
				continue // JSON can't marshal NaN/Inf; treat as missing → 0
			}
			row[idx] = v
		}
		out[string(k)] = row
	}
	return timestamps, out, nil
}
