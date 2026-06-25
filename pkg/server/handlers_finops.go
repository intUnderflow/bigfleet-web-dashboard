package server

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/intUnderflow/bigfleet-web-dashboard/pkg/api"
)

// PromQL drawn from docs/user-stories.md §"Cost analysis" in the BigFleet repo.
// Every block in that section maps to a panel on this page:
//
//   sum by (capacity_type) (bigfleet_shard_inventory_machines{state=~"Configured|Idle"})
//   sum by (capacity_type, interruption_penalty_bucket) (…{state="Configured"})
//   sum by (interruption_penalty_bucket) (bigfleet_shard_demand_machines)
//
// plus an explicit Configured/Idle split so the cost-mix card can render the
// two slices independently.
const (
	queryFinopsConfiguredByCapacity    = `sum by (capacity_type) (bigfleet_shard_inventory_machines{state="Configured"})`
	queryFinopsIdleByCapacity          = `sum by (capacity_type) (bigfleet_shard_inventory_machines{state="Idle"})`
	queryFinopsConfiguredByCapBucket   = `sum by (capacity_type, interruption_penalty_bucket) (bigfleet_shard_inventory_machines{state="Configured"})`
	queryFinopsDemandByBucket          = `sum by (interruption_penalty_bucket) (bigfleet_shard_demand_machines)`
	queryFinopsConfiguredByBucket      = `sum by (interruption_penalty_bucket) (bigfleet_shard_inventory_machines{state="Configured"})`
	queryFinopsDemandTotal             = `sum(bigfleet_shard_demand_machines)`
	queryFinopsActionRates             = `sum by (kind) (rate(bigfleet_shard_actions_total[5m]))`
)

var capacityTypeOrder = []string{"BareMetal", "Reserved", "OnDemand", "Spot"}

func (s *Server) finopsHandler(w http.ResponseWriter, r *http.Request) {
	if !s.prom.Configured() {
		writeError(w, http.StatusServiceUnavailable, "prometheus not configured: pass --prometheus-url")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	now := time.Now()

	configuredByCap, err := s.prom.QueryByLabel(ctx, queryFinopsConfiguredByCapacity, "capacity_type", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (configured by capacity_type): "+err.Error())
		return
	}
	idleByCap, err := s.prom.QueryByLabel(ctx, queryFinopsIdleByCapacity, "capacity_type", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (idle by capacity_type): "+err.Error())
		return
	}
	samples, err := s.prom.QueryVector(ctx, queryFinopsConfiguredByCapBucket, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (configured matrix): "+err.Error())
		return
	}
	demand, err := s.prom.QueryByLabel(ctx, queryFinopsDemandByBucket, "interruption_penalty_bucket", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (demand by bucket): "+err.Error())
		return
	}
	configuredByBucket, err := s.prom.QueryByLabel(ctx, queryFinopsConfiguredByBucket, "interruption_penalty_bucket", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (configured by bucket): "+err.Error())
		return
	}
	demandTotal, err := s.prom.QueryScalar(ctx, queryFinopsDemandTotal, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (demand total): "+err.Error())
		return
	}
	actionRates, err := s.prom.QueryByLabel(ctx, queryFinopsActionRates, "kind", now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "prometheus query (action rates): "+err.Error())
		return
	}

	configured := map[string]map[string]float64{}
	capacitySet := map[string]bool{}
	bucketSet := map[string]bool{}
	for _, s := range samples {
		ct := s.Labels["capacity_type"]
		bk := s.Labels["interruption_penalty_bucket"]
		if ct == "" || bk == "" {
			continue
		}
		if configured[ct] == nil {
			configured[ct] = map[string]float64{}
		}
		configured[ct][bk] = s.Value
		capacitySet[ct] = true
		bucketSet[bk] = true
	}
	for ct := range configuredByCap {
		capacitySet[ct] = true
	}
	for ct := range idleByCap {
		capacitySet[ct] = true
	}
	for b := range demand {
		bucketSet[b] = true
	}
	for b := range configuredByBucket {
		bucketSet[b] = true
	}

	configuredTotal := 0.0
	for _, v := range configuredByCap {
		configuredTotal += v
	}
	idleTotal := 0.0
	for _, v := range idleByCap {
		idleTotal += v
	}
	pinnedConfigured := 0.0
	for ct := range configured {
		pinnedConfigured += configured[ct]["pinned"]
	}

	totals := api.FinOpsTotals{
		ConfiguredMachines:       int(configuredTotal),
		IdleMachines:             int(idleTotal),
		DemandMachines:           int(demandTotal),
		SpotConfiguredFraction:   fraction(configuredByCap["Spot"], configuredTotal),
		PinnedConfiguredFraction: fraction(pinnedConfigured, configuredTotal),
	}

	resp := api.FinOpsSnapshot{
		Totals:                   totals,
		CapacityTypes:            orderCapacityTypes(capacitySet),
		Buckets:                  orderBuckets(bucketSet),
		ConfiguredByCapacityType: configuredByCap,
		IdleByCapacityType:       idleByCap,
		Configured:               configured,
		ConfiguredByBucket:       configuredByBucket,
		Demand:                   demand,
		ActionRatesPerSec:        actionRates,
		RedFlags:                 detectRedFlags(configured),
		QueriedAt:                now.UTC(),
	}
	writeJSON(w, http.StatusOK, resp)
}

func fraction(numerator, denominator float64) float64 {
	if denominator == 0 {
		return 0
	}
	return numerator / denominator
}

func orderCapacityTypes(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	used := map[string]bool{}
	for _, c := range capacityTypeOrder {
		if set[c] {
			out = append(out, c)
			used[c] = true
		}
	}
	extras := []string{}
	for c := range set {
		if !used[c] {
			extras = append(extras, c)
		}
	}
	sort.Strings(extras)
	return append(out, extras...)
}

func orderBuckets(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for b := range set {
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool { return bucketLess(out[i], out[j]) })
	return out
}

func bucketLess(a, b string) bool {
	if a == b {
		return false
	}
	if a == "pinned" {
		return false
	}
	if b == "pinned" {
		return true
	}
	fa, errA := strconv.ParseFloat(a, 64)
	fb, errB := strconv.ParseFloat(b, 64)
	if errA == nil && errB == nil {
		return fa < fb
	}
	return a < b
}

func detectRedFlags(configured map[string]map[string]float64) []api.FinOpsRedFlag {
	// Initialise non-nil so JSON encodes as `[]` not `null`.
	flags := []api.FinOpsRedFlag{}
	if spot, ok := configured["Spot"]; ok {
		if pinned := spot["pinned"]; pinned > 0 {
			flags = append(flags, api.FinOpsRedFlag{
				Severity:     "danger",
				CapacityType: "Spot",
				Bucket:       "pinned",
				Count:        pinned,
				Message:      "Pinned-penalty workloads on Spot capacity. Phase 1 should not have allowed this; verify the provider's interruption_probability and the operator's PriorityClass → penalty mapping.",
			})
		}
	}
	return flags
}
