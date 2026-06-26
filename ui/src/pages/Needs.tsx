import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConfig } from "../lib/useConfig";
import { useSearchParamState } from "../lib/useSearchParamState";
import { api, type NeedView } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Freshness from "../components/Freshness";

function resStr(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => `${k}=${v}`).join(" ") : "—";
}

const reasonStyle: Record<string, string> = {
  PRIORITY_STARVED: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  NO_MATCHING_SUPPLY: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  TOPOLOGY_UNSATISFIABLE: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  PREEMPTION_EXHAUSTED: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
};

function StatusCell({ n }: { n: NeedView }) {
  if (n.satisfied) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        satisfied
      </span>
    );
  }
  const cls = reasonStyle[n.unmetReason] ?? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${cls}`}>
      {n.unmetReason || "UNMET"}
    </span>
  );
}

export default function Needs() {
  const cfg = useConfig();
  const wired = cfg.data?.coordinatorWired ?? false;

  const [shard, setShard] = useSearchParamState("shard");
  const [filter, setFilter] = useSearchParamState("cluster");

  const topology = useQuery({
    queryKey: ["topology"],
    queryFn: api.topology,
    enabled: wired,
    refetchInterval: 30_000,
  });
  const shards = useMemo(() => topology.data?.shards ?? [], [topology.data]);

  // Default the shard selector to the first registered shard once known.
  useEffect(() => {
    const first = shards[0];
    if (!shard && first) setShard(first.shardId);
  }, [shard, shards, setShard]);

  const needs = useQuery({
    queryKey: ["needs", shard],
    queryFn: () => api.needs(shard),
    enabled: wired && shard !== "",
    refetchInterval: 15_000,
  });

  const rows = useMemo(() => {
    const all = needs.data?.needs ?? [];
    const f = filter.trim().toLowerCase();
    return f ? all.filter((n) => n.clusterId.toLowerCase().includes(f)) : all;
  }, [needs.data, filter]);

  return (
    <>
      <PageHeader
        title="Needs explorer"
        subtitle="A shard's per-Need last-cycle verdict (ShardRead.InspectNeeds): which needs are satisfied vs unmet, and why."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && (
        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Shard
            <select
              value={shard}
              onChange={(e) => setShard(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm font-mono"
            >
              {shards.length === 0 && <option value="">no shards registered</option>}
              {shards.map((s) => (
                <option key={s.shardId} value={s.shardId}>
                  {s.shardId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            Filter by cluster
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="substring…"
              className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm font-mono"
            />
          </label>
          {needs.data && (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Freshness
                unixNanos={needs.data.computedAtUnixNanos}
                cycle={needs.data.cycle}
                staleAfterSec={20}
                emptyLabel="rebuilding (no cycle yet)"
              />
              <span>
                · {formatInt(rows.length)}/{formatInt(needs.data.totalNeeds)} needs
              </span>
            </div>
          )}
        </div>
      )}

      {wired && needs.error && (
        <div className="mt-6">
          <ErrorBox error={needs.error as Error} />
        </div>
      )}

      {wired && !needs.error && needs.isLoading && (
        <div className="mt-4 text-xs text-neutral-500">Loading…</div>
      )}
      {wired && !needs.error && needs.data && rows.length === 0 && (
        <div className="mt-4 text-xs text-neutral-500">
          {needs.data.cycle === 0
            ? "Shard is rebuilding its needs ledger (no cycle yet)."
            : "No needs match."}
        </div>
      )}
      {wired && !needs.error && rows.length > 0 && <NeedsGrid rows={rows} />}
    </>
  );
}

// Column layout shared by the virtualized header and rows.
const gridCols: CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "minmax(110px,1.4fr) 60px minmax(130px,1.8fr) minmax(110px,1.4fr) 92px 150px minmax(110px,1.4fr) 64px minmax(130px,1.8fr)",
};

function HeadCell({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return <div className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</div>;
}

function Cell({
  children,
  right = false,
  mono = false,
  muted = false,
  className = "",
  title,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className={`px-3 truncate ${right ? "text-right tabular-nums" : "text-left"} ${
        mono ? "font-mono text-xs" : ""
      } ${muted ? "text-neutral-500" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

function notes(n: NeedView): string {
  const parts: string[] = [];
  if (n.group) parts.push(`gang ${n.group}`);
  if (n.sameDomain) parts.push(`@${n.sameDomain}`);
  if (n.acquisitionParked) parts.push("parked");
  if (!n.satisfied && n.ageCyclesUnmet > 0) parts.push(`age ${n.ageCyclesUnmet}`);
  return parts.join(" · ");
}

function NeedsHeader() {
  return (
    <div
      style={gridCols}
      className="bg-neutral-50 dark:bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500"
    >
      <HeadCell>Cluster</HeadCell>
      <HeadCell right>Prio</HeadCell>
      <HeadCell>Aggregate</HeadCell>
      <HeadCell>Min unit</HeadCell>
      <HeadCell>Int$/Rec$</HeadCell>
      <HeadCell>Status</HeadCell>
      <HeadCell>Deficit</HeadCell>
      <HeadCell right>Claimed</HeadCell>
      <HeadCell>Notes</HeadCell>
    </div>
  );
}

function NeedRowCells({ n }: { n: NeedView }) {
  return (
    <>
      <Cell mono>{n.clusterId}</Cell>
      <Cell right>{formatInt(n.priority)}</Cell>
      <Cell mono title={resStr(n.aggregateResources)}>
        {resStr(n.aggregateResources)}
      </Cell>
      <Cell mono muted title={resStr(n.minUnit)}>
        {resStr(n.minUnit)}
      </Cell>
      <Cell mono muted>
        {n.interruptionPenaltyBucket}/{n.reclamationPenaltyBucket}
      </Cell>
      <div className="px-3 truncate">
        <StatusCell n={n} />
      </div>
      <Cell
        mono
        className="text-amber-700 dark:text-amber-400"
        title={n.satisfied ? "" : resStr(n.residualDeficit)}
      >
        {n.satisfied ? "—" : resStr(n.residualDeficit)}
      </Cell>
      <Cell right>{formatInt(n.claimedMachineCount)}</Cell>
      <Cell muted title={notes(n)}>
        {notes(n)}
      </Cell>
    </>
  );
}

// Above this many rows the table windows (only the visible slice mounts);
// below it the overhead isn't worth it, so every row renders.
const VIRTUALIZE_OVER = 150;

// NeedsGrid renders the per-Need rows. A shard can hold tens of thousands of
// needs (roadmap v0.3 scale ceilings), so large lists are virtualized;
// small ones render plainly. Fixed-height rows; long cells truncate with a
// title tooltip.
function NeedsGrid({ rows }: { rows: NeedView[] }) {
  if (rows.length <= VIRTUALIZE_OVER) {
    return (
      <section className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-x-auto">
        <NeedsHeader />
        <div>
          {rows.map((n, i) => (
            <div
              key={`${n.clusterId}/${n.group}/${n.priority}/${i}`}
              style={gridCols}
              className="items-center border-t border-neutral-100 dark:border-neutral-800 text-sm py-1.5"
            >
              <NeedRowCells n={n} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  return <VirtualNeedsGrid rows={rows} />;
}

function VirtualNeedsGrid({ rows }: { rows: NeedView[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 37,
    overscan: 14,
  });

  return (
    <section className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <NeedsHeader />
      <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "68vh" }}>
        <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
          {virt.getVirtualItems().map((vi) => {
            const n = rows[vi.index];
            if (!n) return null;
            return (
              <div
                key={vi.key}
                style={{
                  ...gridCols,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
                className="items-center border-t border-neutral-100 dark:border-neutral-800 text-sm"
              >
                <NeedRowCells n={n} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
