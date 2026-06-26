import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import type { AlignedData, Series } from "uplot";
import { api, type FleetActionsSeries, type FleetOverview as FleetOverviewData } from "../lib/api";
import { formatDuration, formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import Sparkline from "../components/Sparkline";
import Tile from "../components/Tile";
import Card from "../components/Card";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import GrafanaPanel, { GrafanaLink } from "../components/GrafanaPanel";

// The dashboard the BigFleet chart ships (test/scaletest/chart/dashboards).
const SCALE_DASHBOARD_UID = "bigfleet-scaletest";
const SCALE_DASHBOARD_SLUG = "bigfleet-scale-test";

export default function FleetOverview() {
  const cfg = useConfig();
  const wired = cfg.data?.prometheusWired ?? false;

  const overview = useQuery({
    queryKey: ["fleet-overview"],
    queryFn: api.fleetOverview,
    enabled: wired,
    refetchInterval: 10_000,
  });

  const actions = useQuery({
    queryKey: ["fleet-actions"],
    queryFn: () => api.fleetActions("1h", "30s"),
    enabled: wired,
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader title="Fleet overview" subtitle="Aggregate health across every shard and cluster." />

      {!cfg.isLoading && !wired && <UnwiredNotice />}

      {wired && (
        <div className="flex flex-col gap-6">
          <Tiles data={overview.data} error={overview.error as Error | null} loading={overview.isLoading} />
          <ActionsCard data={actions.data} error={actions.error as Error | null} loading={actions.isLoading} />
          <GrafanaSection grafanaUrl={cfg.data?.grafanaUrl} />
        </div>
      )}
    </>
  );
}

function GrafanaSection({ grafanaUrl }: { grafanaUrl: string | undefined }) {
  if (!grafanaUrl) return null;
  return (
    <Card
      title="Grafana — scale dashboard"
      subtitle={`embedded panels from ${SCALE_DASHBOARD_UID}`}
      right={<GrafanaLink grafanaUrl={grafanaUrl} uid={SCALE_DASHBOARD_UID} slug={SCALE_DASHBOARD_SLUG} />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <GrafanaPanel grafanaUrl={grafanaUrl} uid={SCALE_DASHBOARD_UID} slug={SCALE_DASHBOARD_SLUG} panelId={2} title="CR creates / sec" />
        <GrafanaPanel grafanaUrl={grafanaUrl} uid={SCALE_DASHBOARD_UID} slug={SCALE_DASHBOARD_SLUG} panelId={96} title="Pod binds cumulative vs target" />
      </div>
    </Card>
  );
}

function Tiles({ data, error, loading }: { data: FleetOverviewData | undefined; error: Error | null; loading: boolean }) {
  if (error) return <ErrorBox error={error} />;

  const ov = data;
  const stateSummary = Object.entries(ov?.machinesByState ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k} ${formatInt(v)}`)
    .join(" · ");

  const shortfallTone = (ov?.shortfalls ?? 0) > 0 ? "danger" : "good";
  const cycleTone = ov && ov.cycleP99Seconds > 5 ? "danger" : ov && ov.cycleP99Seconds > 1 ? "warn" : "good";

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Tile label="Shards" value={loading ? "…" : formatInt(ov?.shards)} />
      <Tile label="Clusters" value={loading ? "…" : formatInt(ov?.clusters)} />
      <Tile label="Machines" value={loading ? "…" : formatInt(ov?.machines)} subtitle={stateSummary || undefined} />
      <Tile label="Shortfalls" value={loading ? "…" : formatInt(ov?.shortfalls)} tone={loading ? "neutral" : shortfallTone} />
      <Tile
        label="Cycle p99 (worst shard)"
        value={loading ? "…" : formatDuration(ov?.cycleP99Seconds)}
        tone={loading ? "neutral" : cycleTone}
      />
    </div>
  );
}

const kindColours: Record<string, string> = {
  Bootstrap: "#2563eb",
  Provision: "#16a34a",
  Reclaim: "#f59e0b",
  Preempt: "#dc2626",
};

function colourFor(kind: string, idx: number): string {
  return kindColours[kind] ?? ["#0891b2", "#7c3aed", "#db2777", "#65a30d"][idx % 4] ?? "#888";
}

function ActionsCard({ data, error, loading }: { data: FleetActionsSeries | undefined; error: Error | null; loading: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(200, entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { aligned, seriesConfig } = useMemo<{ aligned: AlignedData | null; seriesConfig: Series[] }>(() => {
    if (!data || data.timestamps.length === 0) return { aligned: null, seriesConfig: [{}] };
    const aligned: AlignedData = [data.timestamps, ...data.values];
    const seriesConfig: Series[] = [
      {},
      ...data.kinds.map((kind, idx) => ({ label: kind, stroke: colourFor(kind, idx), width: 1.5, points: { show: false } })),
    ];
    return { aligned, seriesConfig };
  }, [data]);

  const legend =
    data && data.kinds.length > 0 ? (
      <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
        {data.kinds.map((k, i) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: colourFor(k, i) }} />
            {k}
          </span>
        ))}
      </div>
    ) : null;

  return (
    <Card title="Action rate by kind" subtitle="sum by (kind) (rate(bigfleet_shard_actions_total[5m])) · last hour" right={legend}>
      <div ref={containerRef} className="h-48">
        {error && <ErrorBox error={error} />}
        {!error && loading && <div className="text-sm text-[var(--text-muted)]">Loading…</div>}
        {!error && !loading && aligned && width > 0 && <Sparkline data={aligned} series={seriesConfig} width={width} height={180} />}
        {!error && !loading && !aligned && <div className="text-sm text-[var(--text-muted)]">No action activity in the last hour.</div>}
      </div>
    </Card>
  );
}
