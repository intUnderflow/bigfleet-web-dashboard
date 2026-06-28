// Presentational kit + pure decision helpers for the Needs workspace.
//
// The organizing idea: a CapacityNeed is not an atom, it is a COLLAPSE — every
// unschedulable pod whose aggregation key (requirements, priority, spread, the
// two penalty buckets) matches folds into one Need (ADR-0027). These parts make
// that roll-up, and the engine's Phase 1/2/3 verdict against it, legible.

import type { ReactNode } from "react";
import type { NeedView, Requirement, TopologySpread } from "../lib/api";
import {
  formatInt,
  formatPenalty,
  formatPriorityCompact,
  formatQuantityValue,
  formatResources,
  parseQuantity,
  penaltyOrdinal,
  PENALTY_LADDER_MAX,
  rawResources,
  shortResourceKey,
} from "../lib/format";
import Badge, { type Tone } from "../components/Badge";

// ── unmet-reason taxonomy → label / tone / why / action ────────────────────
// Copy is domain-checked: no "Spot tier" (no spot routing exists — routing is
// by effective_cost), no "reduce pod count" (ADR-0027: demand is a vector, not
// a count), no "rebalance onto a shard" (clusters are permanently shard-bound).
export type ReasonMeta = { label: string; tone: Tone; explain: string; action: string };

export const REASONS: Record<string, ReasonMeta> = {
  PRIORITY_STARVED: {
    label: "priority-starved",
    tone: "warn",
    explain:
      "Machines of your shape exist, but higher-precedence needs claimed them this cycle — you are below the cut-line, and Phase 2 found nothing cheaper to displace.",
    action:
      "If the competing work matters less, lower its priority or wait for it to drain. Otherwise this is priority queuing working as designed under scarcity — add capacity for this shape.",
  },
  NO_MATCHING_SUPPLY: {
    label: "no matching supply",
    tone: "danger",
    explain:
      "No machine satisfying your requirements exists in this shard's inventory in any state, and provisioning could not produce one this cycle.",
    action:
      "Either the providers don't offer this shape — relax the requirements (instance-type / zone / label selectors) — or they do but none were available, which is a cloud-account quota limit to raise. The Capacity view shows which.",
  },
  TOPOLOGY_UNSATISFIABLE: {
    label: "topology unsatisfiable",
    tone: "violet",
    explain:
      "This is a co-located (Same-domain) gang, but no single topology domain in this shard holds enough matching supply for the whole gang. Topology constraints never resolve across shard boundaries.",
    action:
      "Shrink the gang's aggregate demand or min-unit, or relax the Same / co-location requirement so the deficit can spread across domains. Domain→shard assignment is the coordinator's; topology never crosses a shard.",
  },
  PREEMPTION_EXHAUSTED: {
    label: "preemption exhausted",
    tone: "warn",
    explain:
      "Phase 2 found lower-precedence victims of your shape and freed some capacity, but not enough to cover your deficit.",
    action:
      "Usually too many high-precedence workloads contend at once. Scale one down or add capacity — there was nothing cheaper left to evict.",
  },
};

export function reasonMeta(n: Pick<NeedView, "satisfied" | "unmetReason">): ReasonMeta {
  if (n.satisfied)
    return { label: "satisfied", tone: "good", explain: "Held from machines this Need already owns, re-affirmed this cycle.", action: "" };
  return (
    REASONS[n.unmetReason] ?? {
      label: (n.unmetReason || "unmet").toLowerCase().replace(/_/g, " "),
      tone: "danger",
      explain: "Unmet this cycle.",
      action: "",
    }
  );
}

// ── coverage + indivisibility math (ADR-0027-safe) ─────────────────────────
/** Worst-covered resource fraction, 0..1. */
export function coverage(n: NeedView): number {
  if (n.satisfied) return 1;
  let min = 1;
  for (const [k, v] of Object.entries(n.aggregateResources ?? {})) {
    const want = parseQuantity(v);
    if (want <= 0) continue;
    const got = Math.max(0, want - parseQuantity(n.residualDeficit?.[k]));
    min = Math.min(min, got / want);
  }
  return min;
}

/** Estimated chunk count = ceil(max_d aggregate[d] / min_unit[d]); the binding
 *  dimension is the resource that drives the ceil. This is an estimate of
 *  MACHINES (the engine's output), never a pod count (ADR-0027). */
export function chunkEstimate(n: NeedView): { total: number; bindingDim: string } | null {
  const mu = n.minUnit;
  if (!mu || Object.keys(mu).length === 0) return null;
  let total = 0;
  let bindingDim = "";
  for (const [k, v] of Object.entries(n.aggregateResources ?? {})) {
    const chunk = parseQuantity(mu[k]);
    if (chunk <= 0) continue;
    const c = Math.ceil(parseQuantity(v) / chunk);
    if (c > total) {
      total = c;
      bindingDim = k;
    }
  }
  return total > 0 ? { total, bindingDim } : null;
}

// ── precedence (priority desc, then arrival asc — the real NeedsTable walk) ──
// Penalties affect effective_cost and the Phase-2 victim score, NOT who claims
// first; the walk order is priority then arrival, so the "ahead of you" view
// must order by that, not by penalty buckets.
export function precedes(a: NeedView, b: NeedView): boolean {
  if (a.priority !== b.priority) return a.priority > b.priority;
  return (a.arrivalUnixNanos ?? 0) < (b.arrivalUnixNanos ?? 0);
}

export function shapesOverlap(a: NeedView, b: NeedView): boolean {
  const kb = new Set(Object.keys(b.aggregateResources ?? {}));
  return Object.keys(a.aggregateResources ?? {}).some((k) => kb.has(k));
}

/** Higher-precedence needs that claimed machines this cycle and demand an
 *  overlapping shape — a precedence-ordered approximation of "who's ahead of
 *  you in line" (the exact displacement chain is barrier-discarded). */
export function competitorsFor(n: NeedView, all: NeedView[]): NeedView[] {
  return all
    .filter((o) => o !== n && o.claimedMachineCount > 0 && precedes(o, n) && shapesOverlap(o, n))
    .sort((x, y) => (precedes(x, y) ? -1 : 1))
    .slice(0, 8);
}

// ── small atoms ────────────────────────────────────────────────────────────
export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">{title}</div>
        {hint && <div className="text-[11px] leading-snug text-[var(--text-subtle)]/80">· {hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs text-[var(--text-muted)]">{k}</dt>
      <dd className="min-w-0 break-words text-right text-sm text-[var(--text)]">{v}</dd>
    </div>
  );
}

// ── requirement + spread chips (the structured aggregation key) ────────────
const OP_GLYPH: Record<string, string> = {
  In: "∈",
  NotIn: "∉",
  Exists: "∃",
  DoesNotExist: "∄",
  Same: "⋈",
};

export function RequirementChip({ req }: { req: Requirement }) {
  const same = req.operator === "Same";
  const glyph = OP_GLYPH[req.operator] ?? req.operator;
  const vals = req.values && req.values.length > 0 ? req.values.join(", ") : "";
  return (
    <span
      title={`${req.key} ${req.operator}${vals ? ` [${vals}]` : ""}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
        same
          ? "border-violet-400/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]"
      }`}
    >
      <span className="truncate text-[var(--text)]">{shortResourceKey(req.key)}</span>
      <span className={same ? "text-violet-500" : "text-[var(--text-subtle)]"}>{glyph}</span>
      {vals && <span className="truncate">{vals}</span>}
      {same && <span className="text-[10px] uppercase tracking-wide text-violet-500">co-loc</span>}
    </span>
  );
}

export function SpreadChip({ s }: { s: TopologySpread }) {
  const hard = s.whenUnsatisfiable === "DoNotSchedule";
  return (
    <span
      title={`topology spread on ${s.topologyKey}, maxSkew ${s.maxSkew}, ${s.whenUnsatisfiable}`}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-muted)]"
    >
      <span className="text-[var(--text-subtle)]">spread</span>
      <span className="text-[var(--text)]">{shortResourceKey(s.topologyKey)}</span>
      <span className="text-[var(--text-subtle)]">skew≤{s.maxSkew}</span>
      {hard && <span className="text-[10px] uppercase tracking-wide text-amber-500">hard</span>}
    </span>
  );
}

// ── penalty pill + log-ladder thermometer ──────────────────────────────────
type PenaltyKind = "interruption" | "reclamation";
const PENALTY_ACCENT: Record<PenaltyKind, string> = {
  interruption: "bg-amber-500", // warm — interrupting the workload
  reclamation: "bg-teal-500", // cool — operational value of the machine
};

export function PenaltyPill({ bucket, kind }: { bucket: string; kind: PenaltyKind }) {
  const pinned = bucket.toUpperCase() === "PINNED";
  return (
    <span
      title={`${kind} penalty: ${bucket}`}
      className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]"
    >
      <span className={`h-2.5 w-1 rounded-sm ${PENALTY_ACCENT[kind]}`} aria-hidden />
      {pinned ? "📌" : formatPenalty(bucket)}
    </span>
  );
}

/** A 27-stop log thermometer filled to the bucket's ordinal. Interruption runs
 *  warm, reclamation cool; the two penalties are distinct mechanisms and never
 *  read as one lever. */
export function PenaltyLadder({ bucket, kind }: { bucket: string; kind: PenaltyKind }) {
  const ord = penaltyOrdinal(bucket);
  const pinned = ord >= PENALTY_LADDER_MAX;
  const fill = PENALTY_ACCENT[kind];
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-end gap-[1px]" aria-hidden>
        {Array.from({ length: PENALTY_LADDER_MAX }, (_, i) => (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] ${i < ord ? fill : "bg-[var(--surface-3)]"}`}
            style={{ height: `${6 + (i / PENALTY_LADDER_MAX) * 8}px` }}
          />
        ))}
      </div>
      <span className="font-mono text-xs tabular-nums text-[var(--text)]">
        {formatPenalty(bucket)}
        {pinned && " 🔒"}
      </span>
    </div>
  );
}

// ── segmented chunk meter (demand in indivisible min-unit chunks) ───────────
const CHUNK_CAP = 16;
export function ChunkMeter({ n }: { n: NeedView }) {
  const est = chunkEstimate(n);
  const cov = coverage(n);
  // Demand expressed in chunks; covered vs short split by the coverage ratio.
  const total = est ? est.total : 1;
  const shown = Math.min(total, CHUNK_CAP);
  const covered = n.satisfied ? shown : Math.round(cov * shown);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className={`h-3.5 w-3.5 rounded-[3px] ${
            i < covered
              ? "bg-emerald-500"
              : "border border-dashed border-amber-500/70 bg-amber-500/5"
          }`}
        />
      ))}
      {total > CHUNK_CAP && <span className="ml-1 font-mono text-[11px] text-[var(--text-subtle)]">+{formatInt(total - CHUNK_CAP)}</span>}
    </div>
  );
}

// ── thin coverage bar (master cell + fallbacks) ────────────────────────────
export function CoverageBar({ n, w = "w-16" }: { n: NeedView; w?: string }) {
  const cov = coverage(n);
  return (
    <div className={`h-1.5 ${w} shrink-0 overflow-hidden rounded-full bg-[var(--surface-3)]`}>
      <div
        className={`h-full rounded-full ${n.satisfied ? "bg-emerald-500" : cov > 0 ? "bg-amber-500" : "bg-red-500"}`}
        style={{ width: `${Math.max(3, cov * 100)}%` }}
      />
    </div>
  );
}

// ── decision trace ─────────────────────────────────────────────────────────
// A Need's verdict is re-derived every cycle. The fields split into STANDING
// state (claimed_machine_count — the complete held-set this cycle, incl.
// already-configured machines carried from prior cycles) and per-cycle DELTAS
// (bootstrap/provision = acquired THIS cycle; preemption = only when Phase 2
// ran). For the satisfied ~99% the deltas are 0, so a per-cycle waterfall reads
// empty and self-contradictory ("claimed nothing → satisfied"). So we lead on
// the standing claim for satisfied Needs and reserve the acquire→preempt
// waterfall for the unmet case, where the per-cycle steps actually carry signal.
// Phase 3 (reclaim) releases idle capacity at the shard level and never
// acquires for a Need — it has no per-Need step here, by design.
export function DecisionTrace({ n }: { n: NeedView }) {
  return n.satisfied ? <HeldPanel n={n} /> : <UnmetWaterfall n={n} />;
}

function HeldPanel({ n }: { n: NeedView }) {
  const acquired = n.bootstrapCount + n.provisionCount;
  const held = n.claimedMachineCount;
  return (
    <div className="rounded-lg border border-emerald-300/50 bg-emerald-50/40 p-3.5 dark:border-emerald-700/30 dark:bg-emerald-950/15">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-[var(--text)]">{formatInt(held)}</span>
        <span className="text-sm text-[var(--text-muted)]">
          machine{held === 1 ? "" : "s"} held{acquired > 0 ? <> · <span className="text-emerald-700 dark:text-emerald-400">+{formatInt(acquired)} new this cycle</span></> : null}
        </span>
      </div>
      {acquired === 0 ? (
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
          All already configured — carried from earlier cycles and re-affirmed this cycle with no acquisition and no preemption.
          Holding steady with the engine quiet is BigFleet&apos;s <span className="text-[var(--text)]">static-stability</span> property.
        </p>
      ) : (
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
          {formatInt(n.bootstrapCount)} bootstrapped <span className="text-[var(--text-subtle)]">(idle → configured)</span> · {formatInt(n.provisionCount)} provisioned <span className="text-[var(--text-subtle)]">(speculative → configured)</span>
          {held - acquired > 0 ? <> — the other {formatInt(held - acquired)} were already held.</> : "."}
        </p>
      )}
    </div>
  );
}

function UnmetWaterfall({ n }: { n: NeedView }) {
  const acquired = n.bootstrapCount + n.provisionCount;
  const p2 = n.preemption?.victimsFound ?? 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3.5 sm:flex-row sm:items-stretch">
      <WaterfallStage
        phase="Phase 1"
        title="assign"
        body={
          n.claimedMachineCount > 0 ? (
            <span>
              claimed <b className="text-[var(--text)]">{formatInt(n.claimedMachineCount)}</b> machine{n.claimedMachineCount === 1 ? "" : "s"}{acquired > 0 ? ` (+${formatInt(acquired)} new)` : ""} — not enough
            </span>
          ) : (
            <span className="text-[var(--text-subtle)]">claimed nothing — matching supply held above your cut-line</span>
          )
        }
        tone={n.claimedMachineCount > 0 ? "warn" : "muted"}
      />
      <WaterfallArrow />
      <WaterfallStage
        phase="Phase 2"
        title="preempt"
        body={
          n.preemption ? (
            <span>
              {formatInt(p2)} victim{p2 === 1 ? "" : "s"}, freed <b className="text-[var(--text)]">{formatResources(n.preemption.capacityFreed)}</b>
            </span>
          ) : (
            <span className="text-[var(--text-subtle)]">no displaceable victim of your shape</span>
          )
        }
        tone={p2 > 0 ? "warn" : "muted"}
      />
      <WaterfallArrow />
      <WaterfallStage
        phase="Verdict"
        title="still short"
        body={<span className="font-mono text-amber-700 dark:text-amber-400">{formatResources(n.residualDeficit)}</span>}
        tone="danger"
      />
    </div>
  );
}

function WaterfallStage({ phase, title, body, tone }: { phase: string; title: string; body: ReactNode; tone: "good" | "warn" | "danger" | "muted" }) {
  const ring =
    tone === "good"
      ? "border-emerald-400/40"
      : tone === "warn"
        ? "border-amber-400/40"
        : tone === "danger"
          ? "border-red-400/40"
          : "border-[var(--border)]";
  return (
    <div className={`flex-1 rounded-md border ${ring} bg-[var(--surface-2)] px-3 py-2`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">{phase}</span>
        <span className="text-xs font-medium text-[var(--text)]">{title}</span>
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{body}</div>
    </div>
  );
}
function WaterfallArrow() {
  return <div className="hidden items-center text-[var(--text-subtle)] sm:flex">→</div>;
}

// ── kube-scheduler-style supply funnel ─────────────────────────────────────
export function SupplyFunnel({ n }: { n: NeedView }) {
  const ms = n.matchingSupply;
  const matching = ms ? ms.idle + ms.configured + ms.speculative : 0;
  const claimable = ms ? ms.idle + ms.configured : 0; // speculative isn't ready this cycle
  const claimed = n.claimedMachineCount;
  const meta = reasonMeta(n);
  const stages = [
    { label: "Match your requirements", value: matching, hint: ms ? `${formatInt(ms.idle)} idle · ${formatInt(ms.configured)} configured · ${formatInt(ms.speculative)} speculative${ms.capped ? " (capped)" : ""}` : "—" },
    { label: "Ready to claim this cycle", value: claimable, hint: "idle + configured (speculative isn't ready yet)" },
    { label: "Claimed for you", value: claimed, hint: claimed > 0 ? "above the cut-line" : "below the cut-line" },
  ];
  const max = Math.max(matching, claimable, claimed, 1);
  return (
    <div className="rounded-lg border border-[var(--border)] p-3.5">
      <div className="space-y-2">
        {stages.map((s, i) => {
          const isFinal = i === stages.length - 1;
          const drained = isFinal && !n.satisfied;
          return (
            <div key={s.label} className="flex items-center gap-3">
              <div className="w-40 shrink-0 text-xs text-[var(--text-muted)]">{s.label}</div>
              <div className="h-5 flex-1 overflow-hidden rounded bg-[var(--surface-3)]">
                <div
                  className={`flex h-full items-center rounded px-2 ${drained ? "bg-amber-500/20" : "bg-[var(--accent-soft,var(--surface-2))]"}`}
                  style={{ width: `${Math.max(6, (s.value / max) * 100)}%` }}
                >
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text)]">{formatInt(s.value)}{i === 0 && ms?.capped ? "+" : ""}</span>
                </div>
              </div>
              <div className="hidden w-48 shrink-0 text-[11px] text-[var(--text-subtle)] lg:block">{s.hint}</div>
            </div>
          );
        })}
      </div>
      {!n.satisfied && (
        <div className="mt-2.5 border-t border-[var(--border)] pt-2 text-xs">
          <span className="text-[var(--text-subtle)]">supply ran out here · </span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
      )}
    </div>
  );
}

// ── the aggregation-key card (the roll-up identity) ────────────────────────
export function AggregationKeyCard({ n }: { n: NeedView }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
      <p className="mb-3 text-xs leading-relaxed text-[var(--text-muted)]">
        Every unschedulable pod whose fields match this key collapsed into this one Need
        <span className="text-[var(--text-subtle)]"> (ADR-0027)</span>. <span className="text-[var(--text)]">aggregate</span> is their
        vector sum; <span className="text-[var(--text)]">min-unit</span> is the largest single chunk.
      </p>
      <dl className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <KV
          k="requirements"
          v={
            n.requirements && n.requirements.length > 0 ? (
              <div className="flex flex-wrap justify-end gap-1">
                {n.requirements.map((r, i) => (
                  <RequirementChip key={`${r.key}/${r.operator}/${i}`} req={r} />
                ))}
              </div>
            ) : (
              <span className="text-[var(--text-subtle)]">none (any node)</span>
            )
          }
        />
        <KV k="priority" v={<span className="font-mono tabular-nums" title={formatInt(n.priority)}>{formatInt(n.priority)}</span>} />
        {n.spread && n.spread.length > 0 && (
          <KV
            k="spread"
            v={
              <div className="flex flex-wrap justify-end gap-1">
                {n.spread.map((s, i) => (
                  <SpreadChip key={`${s.topologyKey}/${i}`} s={s} />
                ))}
              </div>
            }
          />
        )}
        <KV k="interruption penalty" v={<PenaltyLadder bucket={n.interruptionPenaltyBucket} kind="interruption" />} />
        <KV k="reclamation penalty" v={<PenaltyLadder bucket={n.reclamationPenaltyBucket} kind="reclamation" />} />
      </dl>
      {(n.profileFingerprint || n.group) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-subtle)]">
          {n.group && (
            <span className="inline-flex items-center gap-1 rounded border border-violet-400/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-violet-600 dark:text-violet-300">
              gang {n.group}
            </span>
          )}
          {n.profileFingerprint && (
            <span className="inline-flex items-center gap-1 font-mono" title={`aggregation profile ${n.profileFingerprint}`}>
              profile <span className="text-[var(--text-muted)]">{n.profileFingerprint.slice(0, 12)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── demand-shape block (vector sum ÷ min-unit ≈ chunks) ─────────────────────
export function DemandShape({ n }: { n: NeedView }) {
  const est = chunkEstimate(n);
  return (
    <div className="rounded-lg border border-[var(--border)] p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">aggregate · Σ requested</div>
          <div className="mt-0.5 font-mono text-sm text-[var(--text)]" title={rawResources(n.aggregateResources)}>{formatResources(n.aggregateResources)}</div>
          {n.minUnit && Object.keys(n.minUnit).length > 0 && (
            <div className="mt-2 text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">min-unit · one indivisible chunk</div>
          )}
          {n.minUnit && Object.keys(n.minUnit).length > 0 && (
            <div className="mt-0.5 font-mono text-sm text-[var(--text)]" title={rawResources(n.minUnit)}>{formatResources(n.minUnit)}</div>
          )}
        </div>
        <div>
          {est && (
            <>
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
                ≈ {formatInt(est.total)} chunk{est.total === 1 ? "" : "s"}
                {est.bindingDim ? <span className="normal-case text-[var(--text-subtle)]"> · bound by {shortResourceKey(est.bindingDim)}</span> : null}
              </div>
              <div className="mt-1.5">
                <ChunkMeter n={n} />
              </div>
            </>
          )}
          <div className="mt-2 text-[11px] leading-snug text-[var(--text-subtle)]">
            an estimate of <span className="text-[var(--text-muted)]">machines</span> (the engine's output) — <span className="text-[var(--text-muted)]">not a pod count</span> (ADR-0027).
          </div>
        </div>
      </div>
      {/* per-resource coverage */}
      <ResourceCoverage n={n} />
    </div>
  );
}

function ResourceCoverage({ n }: { n: NeedView }) {
  const keys = Object.keys(n.aggregateResources ?? {}).sort();
  if (keys.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-3">
      {keys.map((k) => {
        const want = parseQuantity(n.aggregateResources[k]);
        const short = n.satisfied ? 0 : parseQuantity(n.residualDeficit?.[k]);
        const got = Math.max(0, want - short);
        const frac = want > 0 ? got / want : 1;
        return (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate font-mono text-[var(--text-muted)]">{shortResourceKey(k)}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className={`h-full rounded-full ${frac >= 1 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.max(2, frac * 100)}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right font-mono tabular-nums text-[var(--text-muted)]">
              {formatQuantityValue(k, n.aggregateResources[k])}
              {short > 0 ? <span className="text-amber-600 dark:text-amber-400"> · −{formatQuantityValue(k, n.residualDeficit?.[k])}</span> : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── cohort header + cut-line (the priority walk made visible) ──────────────
export function CohortHeader({ fingerprint, count, contested, supply }: { fingerprint: string; count: number; contested: boolean; supply?: { idle: number; configured: number; speculative: number; capped: boolean } }) {
  const total = supply ? supply.idle + supply.configured + supply.speculative : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">{contested ? "contested shape" : "shared shape"}</span>
      <span className="font-mono text-xs text-[var(--text-muted)]" title={`aggregation profile ${fingerprint}`}>{fingerprint.slice(0, 10)}</span>
      <span className="text-[11px] text-[var(--text-subtle)]">· {formatInt(count)} need{count === 1 ? "" : "s"}</span>
      {contested && supply && total > 0 && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--text-subtle)]">
          <span>pool</span>
          <span className="inline-flex h-2 w-24 overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden>
            <span className="bg-emerald-500" style={{ width: `${(supply.idle / total) * 100}%` }} />
            <span className="bg-sky-500" style={{ width: `${(supply.configured / total) * 100}%` }} />
            <span className="bg-violet-500" style={{ width: `${(supply.speculative / total) * 100}%` }} />
          </span>
          <span className="font-mono tabular-nums text-[var(--text-muted)]">{formatInt(total)}{supply.capped ? "+" : ""}</span>
        </span>
      )}
    </div>
  );
}

export function CutLine({ below }: { below: number }) {
  return (
    <div className="relative flex items-center justify-center py-1">
      <div className="absolute inset-x-3 h-px bg-amber-500/60" aria-hidden />
      <span className="relative rounded-full border border-amber-500/50 bg-[var(--surface)] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
        supply exhausted here · {formatInt(below)} need{below === 1 ? "" : "s"} below the cut-line
      </span>
    </div>
  );
}

export { formatPriorityCompact, formatResources, formatPenalty };
