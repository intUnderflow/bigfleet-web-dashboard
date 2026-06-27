import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConfig } from "../lib/useConfig";
import { useSearchParamState } from "../lib/useSearchParamState";
import { api, type NeedView } from "../lib/api";
import { formatInt } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import EmptyState from "../components/EmptyState";
import Freshness from "../components/Freshness";
import Badge, { type Tone } from "../components/Badge";
import Drawer from "../components/Drawer";

const ALL = "*";

// ── resource formatting ───────────────────────────────────────────────
// {cpu:"32","nvidia.com/gpu":"8"} → "32 cpu · 8 gpu"
function shortKey(k: string): string {
  return k.replace(/^nvidia\.com\//, "").replace(/^.*\//, "");
}
function fmtRes(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => `${v} ${shortKey(k)}`).join(" · ") : "—";
}

// ── unmet-reason taxonomy → label / tone / plain-English explanation ───
type ReasonMeta = { label: string; tone: Tone; explain: string };
const REASONS: Record<string, ReasonMeta> = {
  PRIORITY_STARVED: {
    label: "priority-starved",
    tone: "warn",
    explain:
      "Higher-priority needs claimed the available supply this cycle. It gets capacity once they're satisfied or more is provisioned.",
  },
  NO_MATCHING_SUPPLY: {
    label: "no matching supply",
    tone: "danger",
    explain:
      "No machine type the providers offer matches this need's requirements. Check the requirements against the provider catalog.",
  },
  TOPOLOGY_UNSATISFIABLE: {
    label: "topology unsatisfiable",
    tone: "violet",
    explain:
      "The need's Same-domain (co-location) constraint can't be met within this shard. Topology constraints never resolve cross-shard.",
  },
  PREEMPTION_EXHAUSTED: {
    label: "preemption exhausted",
    tone: "warn",
    explain: "There were no lower-value victims left to preempt for this need this cycle.",
  },
};
function reasonMeta(n: NeedView): ReasonMeta {
  if (n.satisfied) return { label: "satisfied", tone: "good", explain: "Claimed from existing or newly-provisioned supply." };
  return (
    REASONS[n.unmetReason] ?? {
      label: (n.unmetReason || "unmet").toLowerCase().replace(/_/g, " "),
      tone: "danger",
      explain: "Unmet this cycle.",
    }
  );
}

type StatusFilter = "all" | "satisfied" | "unmet";

export default function Needs() {
  const cfg = useConfig();
  const wired = cfg.data?.coordinatorWired ?? false;

  const [shard, setShard] = useSearchParamState("shard");
  const [cluster, setCluster] = useSearchParamState("cluster");
  const [statusRaw, setStatus] = useSearchParamState("status", "all");
  const status: StatusFilter = (["all", "satisfied", "unmet"] as const).includes(statusRaw as StatusFilter)
    ? (statusRaw as StatusFilter)
    : "all";
  const [selected, setSelected] = useState<NeedView | null>(null);

  const topology = useQuery({ queryKey: ["topology"], queryFn: api.topology, enabled: wired, refetchInterval: 30_000 });
  const shards = useMemo(() => topology.data?.shards ?? [], [topology.data]);

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
  const all = useMemo(() => needs.data?.needs ?? [], [needs.data]);

  // Per-cluster index: total + unmet counts, problem clusters first.
  const clusters = useMemo(() => {
    const m = new Map<string, { total: number; unmet: number }>();
    for (const n of all) {
      const e = m.get(n.clusterId) ?? { total: 0, unmet: 0 };
      e.total++;
      if (!n.satisfied) e.unmet++;
      m.set(n.clusterId, e);
    }
    return [...m.entries()]
      .map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => b.unmet - a.unmet || a.id.localeCompare(b.id));
  }, [all]);

  // Default the cluster scope to the first (most-troubled) cluster.
  useEffect(() => {
    if (!cluster && clusters.length > 0) setCluster(clusters[0]!.id);
  }, [cluster, clusters, setCluster]);

  const scoped = useMemo(
    () => (cluster && cluster !== ALL ? all.filter((n) => n.clusterId === cluster) : all),
    [all, cluster],
  );
  const rows = useMemo(() => {
    if (status === "satisfied") return scoped.filter((n) => n.satisfied);
    if (status === "unmet") return scoped.filter((n) => !n.satisfied);
    return scoped;
  }, [scoped, status]);

  // Status summary for the current cluster scope.
  const summary = useMemo(() => {
    let satisfied = 0;
    const byReason = new Map<string, number>();
    for (const n of scoped) {
      if (n.satisfied) satisfied++;
      else byReason.set(n.unmetReason, (byReason.get(n.unmetReason) ?? 0) + 1);
    }
    return { satisfied, byReason };
  }, [scoped]);

  const showCluster = cluster === ALL;

  return (
    <>
      <PageHeader
        title="Needs"
        subtitle="A shard's per-Need last-cycle verdict (ShardRead.InspectNeeds) — which of a cluster's needs are satisfied vs unmet, by how much, and why."
        right={
          needs.data && (
            <Freshness
              unixNanos={needs.data.computedAtUnixNanos}
              cycle={needs.data.cycle}
              staleAfterSec={20}
              emptyLabel="rebuilding (no cycle yet)"
            />
          )
        }
      />

      {!cfg.isLoading && !wired && <UnwiredNotice source="Coordinator" flag="--coordinator-addr" />}

      {wired && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Shard">
            <select value={shard} onChange={(e) => setShard(e.target.value)} className="bf-input font-mono">
              {shards.length === 0 && <option value="">no shards registered</option>}
              {shards.map((s) => (
                <option key={s.shardId} value={s.shardId}>
                  {s.shardId}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cluster">
            <select value={cluster || ""} onChange={(e) => setCluster(e.target.value)} className="bf-input font-mono">
              <option value={ALL}>All clusters ({formatInt(all.length)})</option>
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} ({c.total}{c.unmet > 0 ? ` · ${c.unmet} unmet` : ""})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="bf-input">
              <option value="all">All</option>
              <option value="unmet">Unmet only</option>
              <option value="satisfied">Satisfied only</option>
            </select>
          </Field>
        </div>
      )}

      {wired && needs.error && (
        <div className="mt-6">
          <ErrorBox error={needs.error as Error} />
        </div>
      )}

      {wired && !needs.error && needs.isLoading && (
        <div className="mt-6 text-sm text-[var(--text-muted)]">Loading needs…</div>
      )}

      {wired && !needs.error && needs.data && all.length === 0 && (
        <div className="mt-6">
          <EmptyState tone="warn" title={needs.data.cycle === 0 ? "Shard is rebuilding its needs ledger" : "No needs on this shard"}>
            {needs.data.cycle === 0
              ? "No cycle has completed yet — the shard re-derives its per-Need verdicts each cycle."
              : "The shard reports no capacity needs right now."}
          </EmptyState>
        </div>
      )}

      {wired && !needs.error && all.length > 0 && (
        <>
          <SummaryBar satisfied={summary.satisfied} byReason={summary.byReason} total={scoped.length} />
          {rows.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="Nothing matches">No needs match the current cluster + status filters.</EmptyState>
            </div>
          ) : (
            <NeedsTable rows={rows} showCluster={showCluster} onSelect={setSelected} />
          )}
        </>
      )}

      <NeedDrawer need={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
      {label}
      {children}
    </label>
  );
}

function SummaryBar({
  satisfied,
  byReason,
  total,
}: {
  satisfied: number;
  byReason: Map<string, number>;
  total: number;
}) {
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--text-subtle)]">{formatInt(total)} needs ·</span>
      <Badge tone="good" dot>
        {formatInt(satisfied)} satisfied
      </Badge>
      {reasons.map(([reason, n]) => {
        const meta = reasonMeta({ satisfied: false, unmetReason: reason } as NeedView);
        return (
          <Badge key={reason} tone={meta.tone} dot>
            {formatInt(n)} {meta.label}
          </Badge>
        );
      })}
      {reasons.length === 0 && satisfied > 0 && (
        <span className="text-xs text-[var(--text-muted)]">all satisfied 🎉</span>
      )}
    </div>
  );
}

// ── table ──────────────────────────────────────────────────────────────
function gridCols(showCluster: boolean): CSSProperties {
  return {
    display: "grid",
    // Priority track is a fixed 128px (not 80px): BigFleet priorities go up to ~1e9 (the critical
    // tier renders as "1,000,000,000", ~13 chars) which overflowed the old 80px column into the
    // Demand cell. Each row is its own grid, so the track must be fixed to stay aligned across
    // rows — auto/max-content would size per-row and misalign the columns.
    gridTemplateColumns: showCluster
      ? "minmax(150px,170px) minmax(120px,1fr) 128px minmax(170px,1.4fr) 64px 34px"
      : "minmax(150px,180px) 128px minmax(180px,1fr) 64px 34px",
    alignItems: "center",
  };
}

function StatusPill({ n }: { n: NeedView }) {
  const meta = reasonMeta(n);
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

function DemandCell({ n }: { n: NeedView }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-xs text-[var(--text)]">{fmtRes(n.aggregateResources)}</span>
      {!n.satisfied && n.residualDeficit && (
        <span className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          short {fmtRes(n.residualDeficit)}
        </span>
      )}
    </div>
  );
}

function HeadCell({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <div className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)] ${right ? "text-right" : ""}`}>
      {children}
    </div>
  );
}

function NeedsTableHeader({ showCluster }: { showCluster: boolean }) {
  return (
    <div style={gridCols(showCluster)} className="border-b border-[var(--border)] bg-[var(--surface-2)]">
      <HeadCell>Status</HeadCell>
      {showCluster && <HeadCell>Cluster</HeadCell>}
      <HeadCell right>Priority</HeadCell>
      <HeadCell>Demand</HeadCell>
      <HeadCell right>Age</HeadCell>
      <div />
    </div>
  );
}

function NeedRow({ n, showCluster, onSelect }: { n: NeedView; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      style={gridCols(showCluster)}
      className="w-full border-b border-[var(--border)] text-left transition-colors last:border-0 hover:bg-[var(--surface-2)]"
    >
      <div className="px-3 py-2">
        <StatusPill n={n} />
      </div>
      {showCluster && (
        <div className="truncate px-3 font-mono text-xs text-[var(--text)]" title={n.clusterId}>
          {n.clusterId}
        </div>
      )}
      <div className="px-3 text-right tabular-nums text-sm text-[var(--text)]">{formatInt(n.priority)}</div>
      <div className="min-w-0 px-3">
        <DemandCell n={n} />
      </div>
      <div className="px-3 text-right tabular-nums text-xs text-[var(--text-muted)]">
        {!n.satisfied && n.ageCyclesUnmet > 0 ? `${formatInt(n.ageCyclesUnmet)}c` : "—"}
      </div>
      <div className="grid place-items-center text-[var(--text-subtle)]">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  );
}

const VIRTUALIZE_OVER = 150;

function NeedsTable({ rows, showCluster, onSelect }: { rows: NeedView[]; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <NeedsTableHeader showCluster={showCluster} />
      {rows.length <= VIRTUALIZE_OVER ? (
        <div>
          {rows.map((n, i) => (
            <NeedRow key={`${n.clusterId}/${n.group}/${n.priority}/${i}`} n={n} showCluster={showCluster} onSelect={onSelect} />
          ))}
        </div>
      ) : (
        <VirtualRows rows={rows} showCluster={showCluster} onSelect={onSelect} />
      )}
    </section>
  );
}

function VirtualRows({ rows, showCluster, onSelect }: { rows: NeedView[]; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 41,
    overscan: 14,
  });
  return (
    <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "66vh" }}>
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((vi) => {
          const n = rows[vi.index];
          if (!n) return null;
          return (
            <div
              key={vi.key}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <NeedRow n={n} showCluster={showCluster} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── detail drawer ────────────────────────────────────────────────────────
function NeedDrawer({ need, onClose }: { need: NeedView | null; onClose: () => void }) {
  const meta = need ? reasonMeta(need) : null;
  return (
    <Drawer
      open={need !== null}
      onClose={onClose}
      title={need ? <span className="font-mono">{need.clusterId}</span> : ""}
      subtitle={need ? `priority ${formatInt(need.priority)}${need.group ? ` · gang ${need.group}` : ""}` : undefined}
    >
      {need && meta && (
        <div className="space-y-5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
            <Badge tone={meta.tone} dot>
              {need.satisfied ? "satisfied" : `unmet · ${meta.label}`}
            </Badge>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-muted)]">{meta.explain}</p>
          </div>

          <DetailGroup title="Demand">
            <KV k="Wants" v={fmtRes(need.aggregateResources)} mono />
            {need.minUnit && <KV k="Min unit" v={fmtRes(need.minUnit)} mono />}
            {!need.satisfied && <KV k="Short by" v={fmtRes(need.residualDeficit)} mono tone="warn" />}
            <KV
              k="Claimed"
              v={`${formatInt(need.claimedMachineCount)} machines${
                need.bootstrapCount + need.provisionCount > 0
                  ? ` (${formatInt(need.bootstrapCount)} bootstrap · ${formatInt(need.provisionCount)} provision)`
                  : ""
              }`}
            />
          </DetailGroup>

          {(need.sameDomain || (need.requirements && need.requirements.length > 0)) && (
            <DetailGroup title="Topology">
              {need.sameDomain && (
                <KV
                  k="Same domain"
                  v={
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono">{need.sameDomain}</span>
                      <Badge tone={need.sameSatisfiable ? "good" : "violet"}>
                        {need.sameSatisfiable ? "satisfiable" : "unsatisfiable"}
                      </Badge>
                    </span>
                  }
                />
              )}
              {need.requirements && need.requirements.length > 0 && (
                <KV k="Requirements" v={<span className="font-mono text-xs">{need.requirements.join(" · ")}</span>} />
              )}
            </DetailGroup>
          )}

          <DetailGroup title="Scheduling">
            <KV k="Interruption penalty" v={need.interruptionPenaltyBucket} mono />
            <KV k="Reclamation penalty" v={need.reclamationPenaltyBucket} mono />
            {!need.satisfied && <KV k="Unmet for" v={`${formatInt(need.ageCyclesUnmet)} cycles`} />}
            {need.acquisitionParked && <KV k="Acquisition" v={<Badge tone="warn">parked</Badge>} />}
          </DetailGroup>
        </div>
      )}
    </Drawer>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">{title}</div>
      <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">{children}</dl>
    </div>
  );
}

function KV({ k, v, mono = false, tone }: { k: string; v: ReactNode; mono?: boolean; tone?: "warn" }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs text-[var(--text-muted)]">{k}</dt>
      <dd
        className={`min-w-0 break-words text-right text-sm ${mono ? "font-mono text-xs" : ""} ${
          tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-[var(--text)]"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}
