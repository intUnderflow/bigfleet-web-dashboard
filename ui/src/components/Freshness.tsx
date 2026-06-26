import { formatRelative } from "../lib/format";

/**
 * Freshness renders the age of a soft-state snapshot from its
 * unix-nanoseconds timestamp, flagging staleness and the "no data yet"
 * (rebuilding / post-failover) state. Used wherever the dashboard shows
 * leader-local or shard-local soft state (ListShardReports, InspectNeeds),
 * which is at most one cycle stale and empty after a failover/restart.
 */
export default function Freshness({
  unixNanos,
  cycle,
  staleAfterSec = 30,
  emptyLabel = "no data yet (rebuilding)",
}: {
  unixNanos: number;
  cycle?: number;
  staleAfterSec?: number;
  emptyLabel?: string;
}) {
  if (!unixNanos || unixNanos <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <Dot className="bg-amber-500" />
        {emptyLabel}
      </span>
    );
  }
  const sec = unixNanos / 1e9;
  const ageSec = Date.now() / 1000 - sec;
  const stale = ageSec > staleAfterSec;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${
        stale ? "text-amber-700 dark:text-amber-400" : "text-[var(--text-muted)]"
      }`}
    >
      <Dot className={stale ? "bg-amber-500" : "bg-emerald-500"} />
      {cycle != null && <span className="tabular-nums">cycle {cycle} · </span>}
      updated {formatRelative(sec)}
      {stale && " (stale)"}
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} />;
}
