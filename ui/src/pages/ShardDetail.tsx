import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api, type ShardDetail as ShardDetailData } from "../lib/api";
import { formatDuration, formatInt, formatRate } from "../lib/format";
import { capacityTypeColours, colourFor, stateColours } from "../lib/colours";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Tile from "../components/Tile";
import StackedBar from "../components/StackedBar";
import Card from "../components/Card";
import TimeSeriesChart from "../components/TimeSeriesChart";

export default function ShardDetail() {
  const params = useParams();
  const pod = params.pod ?? "";

  const cfg = useConfig();
  const wired = cfg.data?.prometheusWired ?? false;

  const detail = useQuery({
    queryKey: ["shard", pod],
    queryFn: () => api.shard(pod),
    enabled: wired && pod !== "",
    refetchInterval: 10_000,
  });

  return (
    <>
      <PageHeader
        title={
          <span className="font-mono">
            <Link to="/shards" className="text-[var(--text-muted)] hover:underline">shards</Link>
            <span className="text-[var(--text-subtle)]"> / </span>
            <span>{pod}</span>
          </span>
        }
        subtitle="Per-shard cycle, inventory, action rates, and OCC broker stats."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice />}
      {wired && detail.error && <ErrorBox error={detail.error as Error} />}

      <div className="flex flex-col gap-6">
        {wired && !detail.error && detail.data && <Detail data={detail.data} />}
        {wired && !detail.error && !detail.data && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
        {wired && pod !== "" && <TrendsCard pod={pod} />}
      </div>
    </>
  );
}

const actionKindColours: Record<string, string> = {
  Bootstrap: "#2563eb",
  Provision: "#16a34a",
  Reclaim: "#f59e0b",
  Preempt: "#dc2626",
};

const trendFallback = ["#0891b2", "#7c3aed", "#db2777", "#65a30d"];

function TrendsCard({ pod }: { pod: string }) {
  const trends = useQuery({
    queryKey: ["shard-trends", pod],
    queryFn: () => api.shardTrends(pod),
    refetchInterval: 30_000,
  });

  const d = trends.data;
  const cycleSeries = [{ label: "cycle p99 (s)", values: d?.cycleP99Seconds ?? [], color: "#7c3aed" }];
  const actionSeries = Object.entries(d?.actionRates ?? {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kind, values], i) => ({
      label: kind,
      values,
      color: actionKindColours[kind] ?? trendFallback[i % trendFallback.length] ?? "#888",
    }));

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Card title="Cycle p99 — last hour" subtitle="histogram_quantile(0.99, …cycle_duration_seconds_bucket{pod=…})">
        {trends.error ? <ErrorBox error={trends.error as Error} /> : <TimeSeriesChart timestamps={d?.timestamps ?? []} series={cycleSeries} />}
      </Card>
      <Card title="Action rate by kind — last hour" subtitle="sum by (kind) (rate(bigfleet_shard_actions_total{pod=…}[5m]))">
        {trends.error ? <ErrorBox error={trends.error as Error} /> : <TimeSeriesChart timestamps={d?.timestamps ?? []} series={actionSeries} />}
      </Card>
    </div>
  );
}

function Detail({ data }: { data: ShardDetailData }) {
  const cycleTone = data.cycleP99Seconds > 5 ? "danger" : data.cycleP99Seconds > 1 ? "warn" : "good";
  const shortfallTone = data.shortfalls > 0 ? "danger" : "good";
  const conflictRatio =
    data.occCommittedPerSec + data.occConflictPerSec > 0
      ? data.occConflictPerSec / (data.occCommittedPerSec + data.occConflictPerSec)
      : 0;
  const conflictTone = conflictRatio > 0.3 ? "danger" : conflictRatio > 0.15 ? "warn" : "good";

  const stateSegments = Object.entries(data.machinesByState ?? {}).map(([k, v], i) => ({
    label: k,
    value: v,
    colour: colourFor(stateColours, k, i),
  }));
  const capacitySegments = Object.entries(data.machinesByCapacityType ?? {}).map(([k, v], i) => ({
    label: k,
    value: v,
    colour: colourFor(capacityTypeColours, k, i),
  }));

  const phaseRows = Object.entries(data.cycleP99ByPhaseSeconds ?? {}).sort((a, b) => b[1] - a[1]);
  const actionRows = Object.entries(data.actionsByKindRatePerSec ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Cycle p99" value={formatDuration(data.cycleP99Seconds)} tone={cycleTone} />
        <Tile label="Machines" value={formatInt(data.machines)} />
        <Tile label="Sessions" value={formatInt(data.activeSessions)} />
        <Tile label="Shortfalls" value={formatInt(data.shortfalls)} tone={shortfallTone} />
        <Tile
          label="OCC conflict rate"
          value={`${(conflictRatio * 100).toFixed(1)}%`}
          subtitle={`${formatRate(data.occCommittedPerSec)} committed · ${formatRate(data.occConflictPerSec)} conflict`}
          tone={conflictTone}
        />
      </div>

      <Card title="Inventory by state" subtitle="sum by (state) (bigfleet_shard_inventory_machines{pod=…})">
        <StackedBar segments={stateSegments} formatValue={(v) => formatInt(v)} />
      </Card>

      <Card title="Inventory by capacity type" subtitle="sum by (capacity_type) (bigfleet_shard_inventory_machines{pod=…})">
        <StackedBar segments={capacitySegments} formatValue={(v) => formatInt(v)} />
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card title="Cycle p99 by phase" subtitle="histogram_quantile(0.99, …phase_duration_seconds_bucket{pod=…})">
          <KVList rows={phaseRows} empty="no data" format={formatDuration} />
        </Card>
        <Card title="Action rate by kind" subtitle="sum by (kind) (rate(bigfleet_shard_actions_total{pod=…}[5m]))">
          <KVList rows={actionRows} empty="no actions in last 5m" format={formatRate} />
        </Card>
      </div>
    </div>
  );
}

function KVList({ rows, empty, format }: { rows: [string, number][]; empty: string; format: (v: number) => string }) {
  if (rows.length === 0) return <div className="text-sm text-[var(--text-muted)]">{empty}</div>;
  return (
    <ul className="text-sm">
      {rows.map(([k, v]) => (
        <li key={k} className="flex items-center justify-between border-b border-[var(--border)] py-1.5 last:border-0">
          <span className="font-mono text-xs text-[var(--text)]">{k}</span>
          <span className="tabular-nums text-[var(--text-muted)]">{format(v)}</span>
        </li>
      ))}
    </ul>
  );
}
