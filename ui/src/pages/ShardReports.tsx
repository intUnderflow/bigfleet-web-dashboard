import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api, type ShardReport, type ShardReportShortfall } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Card from "../components/Card";
import Tile from "../components/Tile";
import Freshness from "../components/Freshness";

type SortField = "priority" | "age" | "bucket";

function bucketShort(b: string): string {
  return b.replace(/^PENALTY_BUCKET_/, "");
}

// bucketRank orders penalty buckets monotonically in dollars for sorting.
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
  const [sort, setSort] = useState<SortField>("priority");

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
        title="Shard reports"
        subtitle="Coordinator.ListShardReports · per-shard inventory + outstanding shortfalls (leader-local soft state)."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && reports.error && (
        <div className="mt-6">
          <ErrorBox error={reports.error as Error} />
        </div>
      )}

      {wired && !reports.error && shards.length === 0 && !reports.isLoading && (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 p-3 text-sm text-amber-900 dark:text-amber-200">
          No shard reports. The coordinator holds none yet — it may be a follower, or rebuilding
          leader-local soft state after a failover (shards re-report within a cycle).
        </div>
      )}

      {wired && allEmpty && (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 p-3 text-sm text-amber-900 dark:text-amber-200">
          Shards are registered but none has reported inventory yet — soft state is rebuilding after a
          failover.
        </div>
      )}

      {wired && shards.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500">
          <span>Sort shortfalls by</span>
          {(["priority", "age", "bucket"] as SortField[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setSort(f)}
              className={`rounded px-2 py-0.5 ${
                sort === f
                  ? "bg-blue-600 text-white"
                  : "border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {wired && !reports.error && (
        <div className="mt-4 flex flex-col gap-4">
          {shards.map((s) => (
            <ShardCard key={s.shardId} report={s} sort={sort} />
          ))}
        </div>
      )}
    </>
  );
}

function ShardCard({ report, sort }: { report: ShardReport; sort: SortField }) {
  const total = report.summary?.totalMachines ?? 0;
  const free = report.summary?.freeMachines ?? 0;
  const types = report.summary
    ? Object.entries(report.summary.instanceTypeCounts).sort((a, b) => b[1] - a[1])
    : [];
  const zones = report.summary
    ? Object.entries(report.summary.zoneCounts).sort((a, b) => b[1] - a[1])
    : [];
  const shortfalls = sortShortfalls(report.shortfalls ?? [], sort);

  return (
    <Card title={report.shardId} subtitle={undefined}>
      <div className="-mt-2 mb-3">
        <Freshness unixNanos={report.receivedAtUnixNs} cycle={report.cycle} staleAfterSec={20} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Machines" value={formatInt(total)} />
        <Tile label="Free" value={formatInt(free)} />
        <Tile label="Instance types" value={formatInt(types.length)} />
        <Tile label="Shortfalls" value={formatInt(shortfalls.length)} tone={shortfalls.length > 0 ? "warn" : "neutral"} />
      </div>

      {(types.length > 0 || zones.length > 0) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Breakdown title="By instance type" entries={types} />
          <Breakdown title="By zone" entries={zones} />
        </div>
      )}

      {shortfalls.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
            Shortfalls
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="text-right font-medium py-1">Priority</th>
                <th className="text-left font-medium py-1 pl-4">Penalty</th>
                <th className="text-right font-medium py-1">Age</th>
                <th className="text-left font-medium py-1 pl-4">Deficit</th>
              </tr>
            </thead>
            <tbody>
              {shortfalls.map((sf, i) => (
                <tr
                  key={`${sf.priority}-${sf.penaltyBucket}-${i}`}
                  className="border-t border-neutral-100 dark:border-neutral-800 text-amber-700 dark:text-amber-400"
                >
                  <td className="py-1 text-right tabular-nums">{formatInt(sf.priority)}</td>
                  <td className="py-1 pl-4 font-mono text-xs">{bucketShort(sf.penaltyBucket)}</td>
                  <td className="py-1 text-right tabular-nums">{formatInt(sf.ageCycles)}</td>
                  <td className="py-1 pl-4 font-mono text-xs">{resStr(sf.deficit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Breakdown({ title, entries }: { title: string; entries: [string, number][] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">{title}</div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {entries.slice(0, 12).map(([k, n]) => (
          <li key={k} className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 py-0.5">
            <span className="font-mono">{k}</span>
            <span className="tabular-nums text-neutral-500">{formatInt(n)}</span>
          </li>
        ))}
        {entries.length > 12 && <li className="text-neutral-500">+{entries.length - 12} more</li>}
      </ul>
    </div>
  );
}
