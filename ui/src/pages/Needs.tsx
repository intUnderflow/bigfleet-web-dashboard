import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import { useConfig } from "../lib/useConfig";
import { useSearchParamState } from "../lib/useSearchParamState";
import { api, type NeedView } from "../lib/api";
import { formatInt, formatPriorityCompact, formatRelative } from "../lib/format";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import EmptyState from "../components/EmptyState";
import Freshness from "../components/Freshness";
import Badge from "../components/Badge";
import Drawer from "../components/Drawer";
import {
  AggregationKeyCard,
  CohortHeader,
  competitorsFor,
  CoverageBar,
  CutLine,
  DecisionTrace,
  DemandShape,
  formatPenalty,
  formatResources,
  KV,
  PenaltyPill,
  precedes,
  reasonMeta,
  RequirementChip,
  Section,
  SupplyFunnel,
} from "./needsKit";

const ALL = "*";
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
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);
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

  const clusters = useMemo(() => {
    const m = new Map<string, { total: number; unmet: number }>();
    for (const n of all) {
      const e = m.get(n.clusterId) ?? { total: 0, unmet: 0 };
      e.total++;
      if (!n.satisfied) e.unmet++;
      m.set(n.clusterId, e);
    }
    return [...m.entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => b.unmet - a.unmet || a.id.localeCompare(b.id));
  }, [all]);

  useEffect(() => {
    if (!cluster && clusters.length > 0) setCluster(clusters[0]!.id);
  }, [cluster, clusters, setCluster]);

  const scoped = useMemo(
    () => (cluster && cluster !== ALL ? all.filter((n) => n.clusterId === cluster) : all),
    [all, cluster],
  );
  const rows = useMemo(() => {
    let r = scoped;
    if (status === "satisfied") r = r.filter((n) => n.satisfied);
    else if (status === "unmet") r = r.filter((n) => !n.satisfied);
    if (reasonFilter) r = r.filter((n) => !n.satisfied && n.unmetReason === reasonFilter);
    return r;
  }, [scoped, status, reasonFilter]);

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
  const walk = useMemo(() => buildWalk(rows, showCluster), [rows, showCluster]);

  return (
    <>
      <PageHeader
        title="Needs"
        subtitle="One cluster's complete desired state this cycle (a full-replacement roll-up), walked top-down by priority. Each Need is the collapse of every pod sharing its aggregation key — this is why it formed and exactly how the engine ruled on it (ShardRead.InspectNeeds)."
        right={
          needs.data && (
            <Freshness unixNanos={needs.data.computedAtUnixNanos} cycle={needs.data.cycle} staleAfterSec={20} emptyLabel="rebuilding (no cycle yet)" />
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
                <option key={s.shardId} value={s.shardId}>{s.shardId}</option>
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

      {wired && needs.error && <div className="mt-6"><ErrorBox error={needs.error as Error} /></div>}
      {wired && !needs.error && needs.isLoading && <div className="mt-6 text-sm text-[var(--text-muted)]">Loading needs…</div>}

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
          <SummaryBar
            satisfied={summary.satisfied}
            byReason={summary.byReason}
            total={scoped.length}
            active={reasonFilter}
            onPick={(r) => setReasonFilter((cur) => (cur === r ? null : r))}
          />
          {rows.length === 0 ? (
            <div className="mt-4"><EmptyState title="Nothing matches">No needs match the current filters.</EmptyState></div>
          ) : (
            <NeedsTable items={walk} showCluster={showCluster} onSelect={setSelected} />
          )}
        </>
      )}

      <DecisionReport need={selected} all={all} onClose={() => setSelected(null)} />
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
  active,
  onPick,
}: {
  satisfied: number;
  byReason: Map<string, number>;
  total: number;
  active: string | null;
  onPick: (reason: string) => void;
}) {
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--text-subtle)]">{formatInt(total)} needs ·</span>
      <Badge tone="good" dot>{formatInt(satisfied)} satisfied</Badge>
      {reasons.map(([reason, n]) => {
        const meta = reasonMeta({ satisfied: false, unmetReason: reason });
        const on = active === reason;
        return (
          <button
            key={reason}
            type="button"
            onClick={() => onPick(reason)}
            className={`rounded-full transition-opacity ${active && !on ? "opacity-45 hover:opacity-80" : ""}`}
            title={on ? "clear filter" : `filter to ${meta.label}`}
          >
            <Badge tone={meta.tone} dot>{formatInt(n)} {meta.label}</Badge>
          </button>
        );
      })}
      {reasons.length === 0 && satisfied > 0 && <span className="text-xs text-[var(--text-muted)]">all satisfied 🎉</span>}
    </div>
  );
}

// ── the walk: precedence-ordered, grouped into contested-shape cohorts ──────
// Items are a flat list of header/cutline/row sentinels so the same model
// drives both the plain and virtualized renderers. Cohorts form only for
// populated fingerprints with ≥2 contending needs; everything else is a flat
// precedence-ordered row (graceful fallback when fingerprints are absent).
type WalkItem =
  | { kind: "header"; key: string; fingerprint: string; count: number; contested: boolean; supply?: NeedView["matchingSupply"] }
  | { kind: "cutline"; key: string; below: number }
  | { kind: "row"; key: string; need: NeedView };

function buildWalk(rows: NeedView[], showCluster: boolean): WalkItem[] {
  const sorted = [...rows].sort((a, b) => (precedes(a, b) ? -1 : precedes(b, a) ? 1 : 0));
  // group by populated fingerprint
  const groups = new Map<string, NeedView[]>();
  const flat: NeedView[] = [];
  for (const n of sorted) {
    const fp = n.profileFingerprint ?? "";
    if (!fp || showCluster) {
      flat.push(n);
      continue;
    }
    const g = groups.get(fp) ?? [];
    g.push(n);
    groups.set(fp, g);
  }
  const items: WalkItem[] = [];
  const cohorts = [...groups.entries()].filter(([, g]) => g.length >= 2);
  const cohortKeys = new Set(cohorts.map(([k]) => k));
  // singleton-fingerprint needs fall back to flat
  for (const [fp, g] of groups) if (!cohortKeys.has(fp)) flat.push(...g);

  // order cohorts by their top need's precedence
  cohorts.sort(([, a], [, b]) => (precedes(a[0]!, b[0]!) ? -1 : 1));
  for (const [fp, g] of cohorts) {
    // A shape is only "contested" if some member is actually unmet — an
    // all-satisfied group sharing a shape isn't scarcity. The contested pool is
    // counted only for unmet members (matching supply is unmet-only), so source
    // it from the first member that carries it.
    const contested = g.some((m) => !m.satisfied);
    const pool = g.find((m) => m.matchingSupply)?.matchingSupply;
    items.push({ kind: "header", key: `h:${fp}`, fingerprint: fp, count: g.length, contested, supply: pool });
    let cut = -1;
    for (let i = 0; i < g.length - 1; i++) {
      if (g[i]!.claimedMachineCount > 0 && !g[i + 1]!.satisfied && g[i + 1]!.claimedMachineCount === 0) {
        cut = i;
        break;
      }
    }
    g.forEach((n, i) => {
      items.push({ kind: "row", key: `r:${fp}:${i}`, need: n });
      if (i === cut) items.push({ kind: "cutline", key: `c:${fp}`, below: g.length - i - 1 });
    });
  }
  // flat tail (precedence-ordered)
  flat
    .sort((a, b) => (precedes(a, b) ? -1 : precedes(b, a) ? 1 : 0))
    .forEach((n, i) => items.push({ kind: "row", key: `f:${i}:${n.clusterId}:${n.priority}`, need: n }));
  return items;
}

function gridCols(showCluster: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: showCluster
      ? "minmax(130px,150px) minmax(96px,140px) 92px minmax(180px,1.4fr) minmax(150px,150px) 50px 28px"
      : "minmax(130px,150px) 92px minmax(190px,1.5fr) minmax(150px,150px) 50px 28px",
    alignItems: "center",
  };
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
      <HeadCell>Shape → coverage</HeadCell>
      <HeadCell>Penalties (int · rec)</HeadCell>
      <HeadCell right>Age</HeadCell>
      <div />
    </div>
  );
}

function SupplyCell({ n }: { n: NeedView }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <CoverageBar n={n} />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        {n.requirements && n.requirements.length > 0 ? (
          n.requirements.slice(0, 2).map((r, i) => <RequirementChip key={i} req={r} />)
        ) : (
          <span className="truncate font-mono text-xs text-[var(--text-muted)]">{formatResources(n.aggregateResources)}</span>
        )}
        {n.requirements && n.requirements.length > 2 && <span className="text-[10px] text-[var(--text-subtle)]">+{n.requirements.length - 2}</span>}
      </div>
      {!n.satisfied && n.residualDeficit && (
        <span className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          short {formatResources(n.residualDeficit)}
        </span>
      )}
    </div>
  );
}

function NeedRow({ n, showCluster, onSelect }: { n: NeedView; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  const meta = reasonMeta(n);
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      style={gridCols(showCluster)}
      className={`w-full border-b border-[var(--border)] text-left transition-colors last:border-0 hover:bg-[var(--surface-2)] ${n.group ? "border-l-2 border-l-violet-500/60" : ""}`}
    >
      <div className="px-3 py-2"><Badge tone={meta.tone} dot>{meta.label}</Badge></div>
      {showCluster && <div className="truncate px-3 font-mono text-xs text-[var(--text)]" title={n.clusterId}>{n.clusterId}</div>}
      <div className="px-3 text-right font-mono tabular-nums text-sm text-[var(--text)]" title={formatInt(n.priority)}>{formatPriorityCompact(n.priority)}</div>
      <div className="min-w-0 px-3"><SupplyCell n={n} /></div>
      <div className="flex items-center gap-1 px-3">
        <PenaltyPill bucket={n.interruptionPenaltyBucket} kind="interruption" />
        <PenaltyPill bucket={n.reclamationPenaltyBucket} kind="reclamation" />
      </div>
      <div className="px-3 text-right tabular-nums text-xs text-[var(--text-muted)]" title={!n.satisfied ? `unmet for ${formatInt(n.ageCyclesUnmet)} cycles` : n.arrivalUnixNanos ? "held since" : ""}>
        {!n.satisfied
          ? n.ageCyclesUnmet > 0 ? `${formatInt(n.ageCyclesUnmet)}c` : "—"
          : n.arrivalUnixNanos ? formatRelative(n.arrivalUnixNanos / 1e9).replace(" ago", "") : "—"}
      </div>
      <div className="grid place-items-center text-[var(--text-subtle)]">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  );
}

function WalkRow({ item, showCluster, onSelect }: { item: WalkItem; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  if (item.kind === "header") return <CohortHeader fingerprint={item.fingerprint} count={item.count} contested={item.contested} supply={item.supply ?? undefined} />;
  if (item.kind === "cutline") return <CutLine below={item.below} />;
  return <NeedRow n={item.need} showCluster={showCluster} onSelect={onSelect} />;
}

const VIRTUALIZE_OVER = 150;

function NeedsTable({ items, showCluster, onSelect }: { items: WalkItem[]; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  const rowCount = items.filter((i) => i.kind === "row").length;
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <NeedsTableHeader showCluster={showCluster} />
      {rowCount <= VIRTUALIZE_OVER ? (
        <div>
          {items.map((it) => (
            <WalkRow key={it.key} item={it} showCluster={showCluster} onSelect={onSelect} />
          ))}
        </div>
      ) : (
        <VirtualRows items={items} showCluster={showCluster} onSelect={onSelect} />
      )}
    </section>
  );
}

function VirtualRows({ items, showCluster, onSelect }: { items: WalkItem[]; showCluster: boolean; onSelect: (n: NeedView) => void }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i]!.kind === "header" ? 34 : items[i]!.kind === "cutline" ? 30 : 42),
    overscan: 14,
  });
  return (
    <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "62vh" }}>
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((vi) => {
          const it = items[vi.index];
          if (!it) return null;
          return (
            <div key={vi.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vi.start}px)` }}>
              <WalkRow item={it} showCluster={showCluster} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── decision drawer: the causal report ─────────────────────────────────────
function DecisionReport({ need, all, onClose }: { need: NeedView | null; all: NeedView[]; onClose: () => void }) {
  const meta = need ? reasonMeta(need) : null;
  return (
    <Drawer
      open={need !== null}
      onClose={onClose}
      size="xl"
      title={need ? <span className="font-mono">{need.clusterId}</span> : ""}
      subtitle={need ? <span>priority {formatInt(need.priority)}{need.group ? ` · gang ${need.group}` : ""} · {formatResources(need.aggregateResources)}</span> : undefined}
    >
      {need && meta && (
        <div className="space-y-5">
          {/* hero verdict + action */}
          <div className={`rounded-lg border p-4 ${need.satisfied ? "border-emerald-300/60 bg-emerald-50 dark:border-emerald-700/40 dark:bg-emerald-950/20" : "border-[var(--border)] bg-[var(--surface-2)]"}`}>
            <Badge tone={meta.tone} dot>{need.satisfied ? "satisfied" : `unmet · ${meta.label}`}</Badge>
            <p className="mt-2.5 text-sm leading-relaxed text-[var(--text-muted)]">{meta.explain}</p>
            {meta.action && (
              <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                <span className="font-semibold text-[var(--text)]">What to do · </span>
                <span className="text-[var(--text-muted)]">{meta.action}</span>
              </div>
            )}
          </div>

          {/* the roll-up identity */}
          <Section title="Aggregation key" hint="the 5-tuple that collapsed pods into this Need">
            <AggregationKeyCard n={need} />
          </Section>

          {/* indivisibility math */}
          <Section title="Demand shape">
            <DemandShape n={need} />
          </Section>

          {/* the decision trace — a "held" panel when satisfied, the
              acquire→preempt waterfall when unmet (where the per-cycle steps
              carry signal) */}
          <Section
            title={need.satisfied ? "How it's held" : "Decision trace"}
            hint={need.satisfied ? "standing state, re-derived this cycle" : "how the engine walked it"}
          >
            <DecisionTrace n={need} />
          </Section>

          {/* supply funnel */}
          {!need.satisfied && need.matchingSupply && (
            <Section title="Supply funnel" hint="inventory → your shape → claimable">
              <SupplyFunnel n={need} />
            </Section>
          )}

          {/* the competition (client-side precedence approximation) */}
          {!need.satisfied && need.unmetReason === "PRIORITY_STARVED" && (
            <Section title="Ahead of you in line" hint="precedence-ordered needs of a compatible shape that claimed machines — an approximation; the exact displacement chain isn't retained">
              <Competition n={need} all={all} />
            </Section>
          )}

          {/* topology (Same) */}
          {(need.sameDomain || (need.sameCandidates && need.sameCandidates.length > 0)) && (
            <Section title="Topology (co-location)">
              <TopologyBlock n={need} />
            </Section>
          )}

          {/* demoted reference: levers + aging */}
          <Section title="Aging & timing">
            <Aging n={need} />
          </Section>

          {/* cross-link spine */}
          <Section title="Related">
            <div className="flex flex-wrap gap-2 text-sm">
              <CrossLink to={`/clusters/${encodeURIComponent(need.clusterId)}`}>This cluster's CapacityRequests →</CrossLink>
              <CrossLink to="/available-capacity">Provider shapes on offer →</CrossLink>
            </div>
          </Section>
        </div>
      )}
    </Drawer>
  );
}

function CrossLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[var(--accent)] hover:bg-[var(--surface-3)]">
      {children}
    </Link>
  );
}

function Competition({ n, all }: { n: NeedView; all: NeedView[] }) {
  const comp = competitorsFor(n, all);
  if (comp.length === 0) return <div className="text-sm text-[var(--text-muted)]">No higher-precedence need with a compatible shape claimed machines this cycle.</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
          <tr>
            <th className="px-3 py-1.5 text-left font-semibold">Cluster</th>
            <th className="px-3 py-1.5 text-right font-semibold">Priority</th>
            <th className="px-3 py-1.5 text-left font-semibold">Wants</th>
            <th className="px-3 py-1.5 text-right font-semibold">Claimed</th>
          </tr>
        </thead>
        <tbody>
          {comp.map((c, i) => (
            <tr key={`${c.clusterId}/${c.priority}/${i}`} className="border-t border-[var(--border)]">
              <td className="px-3 py-1.5 font-mono text-xs">
                {c.clusterId}
                {c.clusterId === n.clusterId && <span className="ml-1 text-[10px] uppercase text-[var(--text-subtle)]">this cluster</span>}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums" title={formatInt(c.priority)}>{formatPriorityCompact(c.priority)}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-muted)]">{formatResources(c.aggregateResources)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(c.claimedMachineCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopologyBlock({ n }: { n: NeedView }) {
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
        {n.group && <KV k="Gang" v={<span className="font-mono">{n.group}</span>} />}
        {n.sameDomain && (
          <KV
            k="Chosen domain"
            v={<span className="inline-flex items-center gap-2"><span className="font-mono">{n.sameDomain}</span><Badge tone={n.sameSatisfiable ? "good" : "violet"}>{n.sameSatisfiable ? "satisfiable" : "unsatisfiable"}</Badge></span>}
          />
        )}
      </dl>
      {n.sameCandidates && n.sameCandidates.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] text-[var(--text-subtle)]">Candidate domains the pre-pass weighed (coverage of your deficit):</div>
          <div className="space-y-1.5">
            {n.sameCandidates.map((c) => (
              <div key={c.domain} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate font-mono text-[var(--text-muted)]">{c.domain}{c.domain === n.sameDomain ? " ◀ chosen" : ""}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div className={`h-full rounded-full ${c.satisfiable ? "bg-emerald-500" : "bg-violet-500"}`} style={{ width: `${Math.max(2, c.coveragePerMille / 10)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right tabular-nums text-[var(--text-muted)]">{Math.round(c.coveragePerMille / 10)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Aging({ n }: { n: NeedView }) {
  return (
    <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {!n.satisfied && <KV k="Unmet for" v={`${formatInt(n.ageCyclesUnmet)} cycles${n.ageCyclesUnmet > 5 ? " (escalated)" : ""}`} />}
      {n.arrivalUnixNanos && n.arrivalUnixNanos > 0 && (
        <KV k="In desired state since" v={formatRelative(n.arrivalUnixNanos / 1e9)} />
      )}
      {n.acquisitionParked && (
        <KV
          k="Acquisition parked"
          v={<span className="inline-flex items-center gap-2"><Badge tone="warn">parked {n.parkedAgeCycles ? `${formatInt(n.parkedAgeCycles)}c` : ""}</Badge><span className="text-xs text-[var(--text-muted)]">re-probes every 32 cycles</span></span>}
        />
      )}
      <KV
        k="Levers"
        v={
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <span className="font-mono text-xs">prio {formatPriorityCompact(n.priority)}</span>
            <span className="text-[var(--text-subtle)]">·</span>
            <span className="font-mono text-xs" title="interruption penalty — feeds effective_cost and the Phase-2 victim score">int {formatPenalty(n.interruptionPenaltyBucket)}</span>
            <span className="text-[var(--text-subtle)]">·</span>
            <span className="font-mono text-xs" title="reclamation penalty — idle tiebreak + Phase 2/3 reluctance to reclaim">rec {formatPenalty(n.reclamationPenaltyBucket)}</span>
          </span>
        }
      />
    </dl>
  );
}
