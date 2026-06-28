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

// ── resource helpers ───────────────────────────────────────────────────
function shortKey(k: string): string {
  return k.replace(/^nvidia\.com\//, "").replace(/^.*\//, "");
}
function fmtRes(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => `${v} ${shortKey(k)}`).join(" · ") : "—";
}
// Best-effort numeric parse of a k8s quantity (cpu, gpu, 128Gi, 500m, …) for
// the coverage bars. Display-only — exactness isn't required.
function parseQty(s: string | undefined): number {
  if (!s) return 0;
  const m = /^([0-9.]+)\s*([a-zA-Z]*)$/.exec(s.trim());
  if (!m) return parseFloat(s) || 0;
  const n = parseFloat(m[1]!);
  const mult: Record<string, number> = {
    "": 1, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12,
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4,
  };
  return n * (mult[m[2]!] ?? 1);
}
// Fraction of the demand met (worst-covered resource), 0..1.
function coverage(n: NeedView): number {
  if (n.satisfied) return 1;
  let min = 1;
  for (const [k, v] of Object.entries(n.aggregateResources ?? {})) {
    const want = parseQty(v);
    if (want <= 0) continue;
    const got = Math.max(0, want - parseQty(n.residualDeficit?.[k]));
    min = Math.min(min, got / want);
  }
  return min;
}

// ── precedence (priority › interruption-penalty › reclamation-penalty) ──
function bucketRank(b: string): number {
  const s = (b ?? "").toUpperCase();
  if (s.includes("PINNED")) return Number.POSITIVE_INFINITY;
  if (s === "ZERO" || s === "$0" || s === "0") return 0;
  if (s.includes("HALF") || s === "$0.50") return 0.5;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function precedence(n: NeedView): [number, number, number] {
  return [n.priority, bucketRank(n.interruptionPenaltyBucket), bucketRank(n.reclamationPenaltyBucket)];
}
function aheadOf(a: NeedView, b: NeedView): number {
  const pa = precedence(a), pb = precedence(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}
function shapesOverlap(a: NeedView, b: NeedView): boolean {
  const kb = new Set(Object.keys(b.aggregateResources ?? {}));
  return Object.keys(a.aggregateResources ?? {}).some((k) => kb.has(k));
}
// Higher-precedence needs that claimed machines this cycle and demand an
// overlapping resource shape — the precedence-ordered heuristic for "who's
// ahead of you in line" (the exact displacement chain isn't retained).
function competitorsFor(n: NeedView, all: NeedView[]): NeedView[] {
  return all
    .filter((o) => o !== n && o.claimedMachineCount > 0 && aheadOf(o, n) > 0 && shapesOverlap(o, n))
    .sort((x, y) => aheadOf(y, x))
    .slice(0, 6);
}

// ── unmet-reason taxonomy → label / tone / why / recommended action ─────
type ReasonMeta = { label: string; tone: Tone; explain: string; action: string };
const REASONS: Record<string, ReasonMeta> = {
  PRIORITY_STARVED: {
    label: "priority-starved",
    tone: "warn",
    explain:
      "Machines of your shape exist, but higher-precedence needs claimed them this cycle — you're below the cut-line with nothing displaceable to take.",
    action:
      "If the competing work is less important, lower its priority or wait for it to drain. Otherwise this is priority queuing working as designed under scarcity — add capacity.",
  },
  NO_MATCHING_SUPPLY: {
    label: "no matching supply",
    tone: "danger",
    explain:
      "No machine of a satisfying shape exists in this shard's inventory at any price, and provisioning couldn't produce one this cycle.",
    action:
      "File a quota increase for the instance type, or relax the need's requirements (instance-type / zone / label selectors) to match what the providers offer.",
  },
  TOPOLOGY_UNSATISFIABLE: {
    label: "topology unsatisfiable",
    tone: "violet",
    explain:
      "This is a Same-domain (co-location) need, but no single topology domain in this shard has enough supply to host the whole gang. Topology constraints never resolve across shards.",
    action:
      "Reduce the gang size (min-unit / pod count), relax the co-location constraint, or rebalance this cluster onto a shard with contiguous domain space.",
  },
  PREEMPTION_EXHAUSTED: {
    label: "preemption exhausted",
    tone: "warn",
    explain:
      "Phase 2 found lower-precedence victims of your shape and freed some, but not enough to cover your deficit.",
    action:
      "Usually too many high-precedence workloads at once. Scale one down, or add capacity — there was nothing cheaper left to evict.",
  },
};
function reasonMeta(n: NeedView): ReasonMeta {
  if (n.satisfied)
    return { label: "satisfied", tone: "good", explain: "Claimed from existing or newly-provisioned supply.", action: "" };
  return (
    REASONS[n.unmetReason] ?? {
      label: (n.unmetReason || "unmet").toLowerCase().replace(/_/g, " "),
      tone: "danger",
      explain: "Unmet this cycle.",
      action: "",
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
    if (status === "satisfied") return scoped.filter((n) => n.satisfied);
    if (status === "unmet") return scoped.filter((n) => !n.satisfied);
    return scoped;
  }, [scoped, status]);

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
        subtitle="Per-Need last-cycle decision report (ShardRead.InspectNeeds) — for one cluster's needs: satisfied vs unmet, the supply arithmetic, and exactly why the engine ruled the way it did."
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
          <SummaryBar satisfied={summary.satisfied} byReason={summary.byReason} total={scoped.length} />
          {rows.length === 0 ? (
            <div className="mt-4"><EmptyState title="Nothing matches">No needs match the current cluster + status filters.</EmptyState></div>
          ) : (
            <NeedsTable rows={rows} showCluster={showCluster} onSelect={setSelected} />
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

function SummaryBar({ satisfied, byReason, total }: { satisfied: number; byReason: Map<string, number>; total: number }) {
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--text-subtle)]">{formatInt(total)} needs ·</span>
      <Badge tone="good" dot>{formatInt(satisfied)} satisfied</Badge>
      {reasons.map(([reason, n]) => {
        const meta = reasonMeta({ satisfied: false, unmetReason: reason } as NeedView);
        return <Badge key={reason} tone={meta.tone} dot>{formatInt(n)} {meta.label}</Badge>;
      })}
      {reasons.length === 0 && satisfied > 0 && <span className="text-xs text-[var(--text-muted)]">all satisfied 🎉</span>}
    </div>
  );
}

// ── master table ─────────────────────────────────────────────────────────
function gridCols(showCluster: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: showCluster
      ? "minmax(150px,168px) minmax(110px,1fr) 72px minmax(200px,1.6fr) 56px 34px"
      : "minmax(150px,180px) 72px minmax(220px,1fr) 56px 34px",
    alignItems: "center",
  };
}

function StatusPill({ n }: { n: NeedView }) {
  const meta = reasonMeta(n);
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
}

// Demand → claimed coverage bar + the residual short chip.
function SupplyCell({ n }: { n: NeedView }) {
  const cov = coverage(n);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className={`h-full rounded-full ${n.satisfied ? "bg-emerald-500" : cov > 0 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ width: `${Math.max(3, cov * 100)}%` }}
        />
      </div>
      <span className="truncate font-mono text-xs text-[var(--text-muted)]">{fmtRes(n.aggregateResources)}</span>
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
      <HeadCell>Demand → coverage</HeadCell>
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
      <div className="px-3 py-2"><StatusPill n={n} /></div>
      {showCluster && <div className="truncate px-3 font-mono text-xs text-[var(--text)]" title={n.clusterId}>{n.clusterId}</div>}
      <div className="px-3 text-right tabular-nums text-sm text-[var(--text)]">{formatInt(n.priority)}</div>
      <div className="min-w-0 px-3"><SupplyCell n={n} /></div>
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
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 41, overscan: 14 });
  return (
    <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "60vh" }}>
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((vi) => {
          const n = rows[vi.index];
          if (!n) return null;
          return (
            <div key={vi.key} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}>
              <NeedRow n={n} showCluster={showCluster} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── decision report (the debugging detail) ───────────────────────────────
function DecisionReport({ need, all, onClose }: { need: NeedView | null; all: NeedView[]; onClose: () => void }) {
  const meta = need ? reasonMeta(need) : null;
  return (
    <Drawer
      open={need !== null}
      onClose={onClose}
      size="xl"
      title={need ? <span className="font-mono">{need.clusterId}</span> : ""}
      subtitle={need ? `priority ${formatInt(need.priority)}${need.group ? ` · gang ${need.group}` : ""} · ${fmtRes(need.aggregateResources)}` : undefined}
    >
      {need && meta && (
        <div className="space-y-5">
          {/* 1. verdict + recommended action */}
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

          {/* 2. supply arithmetic */}
          <Section title="Supply arithmetic">
            <SupplyArithmetic n={need} />
          </Section>

          {/* 3. matching supply in inventory (core) */}
          {!need.satisfied && need.matchingSupply && (
            <Section title="Matching supply in inventory">
              <MatchingSupplyBlock n={need} />
            </Section>
          )}

          {/* 4. the competition (client-side heuristic) */}
          {!need.satisfied && need.unmetReason === "PRIORITY_STARVED" && (
            <Section title="Ahead of you in line" hint="precedence-ordered needs with a compatible shape that claimed machines — an approximation; the exact displacement chain isn't retained">
              <Competition n={need} all={all} />
            </Section>
          )}

          {/* 5. preemption (core) */}
          {need.preemption && (
            <Section title="Preemption attempt (Phase 2)">
              <PreemptionBlock n={need} />
            </Section>
          )}

          {/* 6. topology (Same) */}
          {(need.sameDomain || (need.sameCandidates && need.sameCandidates.length > 0) || (need.requirements && need.requirements.length > 0)) && (
            <Section title="Topology">
              <TopologyBlock n={need} />
            </Section>
          )}

          {/* 7. levers */}
          <Section title="Levers you control">
            <Levers n={need} />
          </Section>

          {/* 8. aging / parking */}
          {(!need.satisfied || need.acquisitionParked) && (
            <Section title="Aging">
              <Aging n={need} />
            </Section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">{title}</div>
        {hint && <div className="text-[11px] text-[var(--text-subtle)]/80">· {hint}</div>}
      </div>
      {children}
    </div>
  );
}

function SupplyArithmetic({ n }: { n: NeedView }) {
  const claimed = n.claimedMachineCount;
  const resources = Object.keys(n.aggregateResources ?? {}).sort();
  return (
    <div className="rounded-lg border border-[var(--border)] p-3.5">
      {/* flow: demand → claimed → deficit */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Step label="wanted" value={fmtRes(n.aggregateResources)} />
        <Arrow />
        <Step
          label="claimed"
          value={`${formatInt(claimed)} machines`}
          sub={n.bootstrapCount + n.provisionCount > 0 ? `${formatInt(n.bootstrapCount)} bootstrap · ${formatInt(n.provisionCount)} provision` : undefined}
        />
        {!n.satisfied && (
          <>
            <Arrow />
            <Step label="short" value={fmtRes(n.residualDeficit)} tone="warn" />
          </>
        )}
      </div>
      {n.minUnit && Object.keys(n.minUnit).length > 0 && (
        <div className="mt-2 text-xs text-[var(--text-muted)]">min unit (one chunk): <span className="font-mono">{fmtRes(n.minUnit)}</span></div>
      )}
      {/* per-resource coverage bars */}
      {resources.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {resources.map((k) => {
            const want = parseQty(n.aggregateResources[k]);
            const short = n.satisfied ? 0 : parseQty(n.residualDeficit?.[k]);
            const got = Math.max(0, want - short);
            const frac = want > 0 ? got / want : 1;
            return (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 truncate font-mono text-[var(--text-muted)]">{shortKey(k)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div className={`h-full rounded-full ${frac >= 1 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.max(2, frac * 100)}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right font-mono tabular-nums text-[var(--text-muted)]">
                  {n.aggregateResources[k]}{short > 0 ? ` · short ${n.residualDeficit?.[k]}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Step({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">{label}</div>
      <div className={`font-mono text-sm ${tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-[var(--text)]"}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-subtle)]">{sub}</div>}
    </div>
  );
}
function Arrow() {
  return <span className="text-[var(--text-subtle)]">→</span>;
}

function MatchingSupplyBlock({ n }: { n: NeedView }) {
  const ms = n.matchingSupply!;
  const total = ms.idle + ms.configured + ms.speculative;
  return (
    <div className="rounded-lg border border-[var(--border)] p-3.5">
      {total === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          <span className="font-semibold text-red-600 dark:text-red-400">No machine of your shape exists</span> in any state — the
          NO_MATCHING_SUPPLY smoking gun. Provisioning couldn't produce one this cycle.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text)]">{formatInt(total)}{ms.capped ? "+" : ""}</span> machines of your shape
            exist{n.unmetReason === "PRIORITY_STARVED" ? " — they're held above your cut-line." : "."}
          </p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <Stat label="idle" value={ms.idle} capped={ms.capped} />
            <Stat label="configured" value={ms.configured} capped={ms.capped} />
            <Stat label="speculative" value={ms.speculative} capped={ms.capped} />
          </div>
        </>
      )}
    </div>
  );
}
function Stat({ label, value, capped }: { label: string; value: number; capped: boolean }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-[var(--text)]">{formatInt(value)}{capped && value >= 256 ? "+" : ""}</div>
    </div>
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
              <td className="px-3 py-1.5 font-mono text-xs">{c.clusterId}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(c.priority)}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-muted)]">{fmtRes(c.aggregateResources)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatInt(c.claimedMachineCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreemptionBlock({ n }: { n: NeedView }) {
  const p = n.preemption!;
  return (
    <div className="rounded-lg border border-[var(--border)] p-3.5 text-sm text-[var(--text-muted)]">
      Phase 2 picked <span className="font-semibold text-[var(--text)]">{formatInt(p.victimsFound)}</span> displaceable
      {p.victimsFound === 1 ? " victim" : " victims"} of your shape, which would free{" "}
      <span className="font-mono text-[var(--text)]">{fmtRes(p.capacityFreed)}</span>
      {!n.satisfied && n.residualDeficit && <> — still short <span className="font-mono text-amber-700 dark:text-amber-400">{fmtRes(n.residualDeficit)}</span></>}.
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
        {n.requirements && n.requirements.length > 0 && <KV k="Requirements" v={<span className="font-mono text-xs">{n.requirements.join(" · ")}</span>} />}
      </dl>
      {n.sameCandidates && n.sameCandidates.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] text-[var(--text-subtle)]">Candidate domains the pre-pass weighed (coverage of your deficit):</div>
          <div className="space-y-1.5">
            {n.sameCandidates.map((c) => (
              <div key={c.domain} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate font-mono text-[var(--text-muted)]">
                  {c.domain}{c.domain === n.sameDomain ? " ◀ chosen" : ""}
                </span>
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

const LEVERS = [
  { key: "priority" as const, name: "Priority", phase: "Phase 1 walk order", effect: "raising it claims supply ahead of more needs" },
  { key: "interruption" as const, name: "Interruption penalty", phase: "effective_cost + Phase 2 victim score", effect: "raising it routes you off interruptible (Spot) tiers and protects you from preemption" },
  { key: "reclamation" as const, name: "Reclamation penalty", phase: "idle tiebreak + Phase 2/3", effect: "raising it makes the engine reluctant to reclaim your machine" },
];
function Levers({ n }: { n: NeedView }) {
  const vals: Record<string, string> = {
    priority: formatInt(n.priority),
    interruption: n.interruptionPenaltyBucket,
    reclamation: n.reclamationPenaltyBucket,
  };
  return (
    <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {LEVERS.map((l) => (
        <div key={l.key} className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm font-medium text-[var(--text)]">{l.name}</dt>
            <dd className="font-mono text-sm tabular-nums text-[var(--text)]">{vals[l.key]}</dd>
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">{l.phase} — {l.effect}</div>
        </div>
      ))}
    </dl>
  );
}

function Aging({ n }: { n: NeedView }) {
  return (
    <dl className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
      {!n.satisfied && <KV k="Unmet for" v={`${formatInt(n.ageCyclesUnmet)} cycles${n.ageCyclesUnmet > 5 ? " (escalated)" : ""}`} />}
      {n.acquisitionParked && (
        <KV
          k="Acquisition parked"
          v={<span className="inline-flex items-center gap-2"><Badge tone="warn">parked {n.parkedAgeCycles ? `${formatInt(n.parkedAgeCycles)}c` : ""}</Badge><span className="text-xs text-[var(--text-muted)]">re-probes every 32 cycles</span></span>}
        />
      )}
    </dl>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs text-[var(--text-muted)]">{k}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-[var(--text)]">{v}</dd>
    </div>
  );
}
