import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { useSearchParamState } from "../lib/useSearchParamState";
import { api, type ShardReport, type ShardReportShortfall } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import EmptyState from "../components/EmptyState";
import Card from "../components/Card";
import Tile from "../components/Tile";
import Badge from "../components/Badge";
import Freshness from "../components/Freshness";

type SortField = "priority" | "age" | "bucket";

function bucketShort(b: string): string {
  return b.replace(/^PENALTY_BUCKET_/, "");
}

function bucketRank(b: string): number {
  const s = bucketShort(b);
  if (s === "PINNED") return Number.POSITIVE_INFINITY;
  if (s === "ZERO") return 0;
  if (s === "HALF_DOLLAR") return 0.5;
  if (s === "UNSPECIFIED" || s === "") return -1;
  const n = Number(s);
  return Number.isFinite(n) ? n : -1;
}

function resStr(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => `${k}=${v}`).join(" ") : "—";
}

function sortShortfalls(rows: ShardReportShortfall[], field: SortField): ShardReportShortfall[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (field) {
      case "age":
        return b.ageCycles - a.ageCycles;
      case "bucket":
        return bucketRank(b.penaltyBucket) - bucketRank(a.penaltyBucket);
      default:
        return b.priority - a.priority;
    }
  });
  return out;
}

export default function ShardReports() {
  const cfg = useConfig();
  const wired = cfg.data?.coordinatorWired ?? false;
  const [sortRaw, setSort] = useSearchParamState("sort", "priority");
  const sort: SortField = (["priority", "age", "bucket"] as const).includes(sortRaw as SortField)
    ? (sortRaw as SortField)
    : "priority";

  const reports = useQuery({
    queryKey: ["shard-reports"],
    queryFn: api.shardReports,
    enabled: wired,
    refetchInterval: 15_000,
  });

  const shards = useMemo(
    () => [...(reports.data?.reports ?? [])].sort((a, b) => a.shardId.localeCompare(b.shardId)),
    [reports.data],
  );
  const allEmpty = shards.length > 0 && shards.every((s) => !s.summary && (s.shortfalls?.length ?? 0) === 0);

  return (
    <>
      <PageHeader
        title="Shard capacity"
        subtitle="Coordinator.ListShardReports · per-shard provider binding, inventory + outstanding shortfalls (leader-local soft state)."
        right={
          shards.length > 0 ? (
            <SortControl sort={sort} setSort={setSort} />
          ) : undefined
        }
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && reports.error && <ErrorBox error={reports.error as Error} />}

      {wired && !reports.error && shards.length === 0 && !reports.isLoading && (
        <EmptyState tone="warn" title="No shard reports yet">
          The coordinator holds none — it may be a follower, or rebuilding leader-local soft state after a
          failover (shards re-report within a cycle).
        </EmptyState>
      )}

      {wired && allEmpty && (
        <EmptyState tone="warn" title="Soft state is rebuilding">
          Shards are registered but none has reported inventory yet — rebuilding after a failover.
        </EmptyState>
      )}

      {wired && !reports.error && shards.length > 0 && (
        <div className="flex flex-col gap-4">
          {shards.map((s) => (
            <ShardCard key={s.shardId} report={s} sort={sort} />
          ))}
        </div>
      )}
    </>
  );
}

function SortControl({ sort, setSort }: { sort: SortField; setSort: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--text-subtle)]">
      <span>Sort shortfalls</span>
      <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
        {(["priority", "age", "bucket"] as SortField[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setSort(f)}
            className={`px-2.5 py-1 transition-colors ${
              sort === f
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}

function ShardCard({ report, sort }: { report: ShardReport; sort: SortField }) {
  const total = report.summary?.totalMachines ?? 0;
  const free = report.summary?.freeMachines ?? 0;
  const types = report.summary ? Object.entries(report.summary.instanceTypeCounts).sort((a, b) => b[1] - a[1]) : [];
  const zones = report.summary ? Object.entries(report.summary.zoneCounts).sort((a, b) => b[1] - a[1]) : [];
  const providerAddr = report.summary?.providerAddress ?? "";
  const shortfalls = sortShortfalls(report.shortfalls ?? [], sort);

  return (
    <Card
      title={<span className="font-mono">{report.shardId}</span>}
      right={<Freshness unixNanos={report.receivedAtUnixNs} cycle={report.cycle} staleAfterSec={20} />}
    >
      <div className="mb-4 flex items-center gap-2 text-sm">
        <span className="text-[var(--text-subtle)]">Provider</span>
        {providerAddr ? (
          <Badge tone="accent" mono>
            {providerAddr}
          </Badge>
        ) : (
          <Badge tone="neutral">in-process fake (not deployed)</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Machines" value={formatInt(total)} />
        <Tile label="Free" value={formatInt(free)} tone={free > 0 ? "good" : "neutral"} />
        <Tile label="Instance types" value={formatInt(types.length)} />
        <Tile label="Shortfalls" value={formatInt(shortfalls.length)} tone={shortfalls.length > 0 ? "warn" : "good"} />
      </div>

      {(types.length > 0 || zones.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Breakdown title="By instance type" entries={types} />
          <Breakdown title="By zone" entries={zones} />
        </div>
      )}

      {shortfalls.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
            Shortfalls
          </div>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
                <tr>
                  <th className="py-2 pl-3 text-right font-semibold">Priority</th>
                  <th className="py-2 pl-4 text-left font-semibold">Penalty</th>
                  <th className="py-2 text-right font-semibold">Age</th>
                  <th className="py-2 pl-4 pr-3 text-left font-semibold">Deficit</th>
                </tr>
              </thead>
              <tbody>
                {shortfalls.map((sf, i) => (
                  <tr
                    key={`${sf.priority}-${sf.penaltyBucket}-${i}`}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="py-1.5 pl-3 text-right tabular-nums">{formatInt(sf.priority)}</td>
                    <td className="py-1.5 pl-4 font-mono text-xs">{bucketShort(sf.penaltyBucket)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--text-muted)]">{formatInt(sf.ageCycles)}</td>
                    <td className="py-1.5 pl-4 pr-3 font-mono text-xs text-amber-700 dark:text-amber-400">{resStr(sf.deficit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function Breakdown({ title, entries }: { title: string; entries: [string, number][] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">{title}</div>
      <ul className="mt-1.5 text-xs">
        {entries.slice(0, 12).map(([k, n]) => (
          <li
            key={k}
            className="flex items-center justify-between border-b border-[var(--border)] py-1 last:border-0"
          >
            <span className="font-mono text-[var(--text)]">{k}</span>
            <span className="tabular-nums text-[var(--text-muted)]">{formatInt(n)}</span>
          </li>
        ))}
        {entries.length > 12 && <li className="py-1 text-[var(--text-subtle)]">+{entries.length - 12} more</li>}
      </ul>
    </div>
  );
}
