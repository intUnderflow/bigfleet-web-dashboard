import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "../lib/useConfig";
import { api, type FinOpsRedFlag, type FinOpsSnapshot } from "../lib/api";
import { formatInt, formatPenaltyBucket, formatPercent, formatRate } from "../lib/format";
import { capacityTypeColours, colourFor } from "../lib/colours";
import PageHeader from "../components/PageHeader";
import UnwiredNotice from "../components/UnwiredNotice";
import ErrorBox from "../components/ErrorBox";
import Tile from "../components/Tile";
import StackedBar from "../components/StackedBar";

export default function FinOps() {
  const cfg = useConfig();
  const wired = cfg.data?.prometheusWired ?? false;

  const snap = useQuery({
    queryKey: ["finops-snapshot"],
    queryFn: api.finopsSnapshot,
    enabled: wired,
    refetchInterval: 20_000,
  });

  return (
    <>
      <PageHeader
        title="FinOps"
        subtitle="Where your money is going across the BigFleet inventory: cost mix, penalty distribution, demand-vs-supply, decision-engine activity."
      />

      {!cfg.isLoading && !wired && <UnwiredNotice />}
      {wired && snap.error && (
        <div className="mt-6">
          <ErrorBox error={snap.error as Error} />
        </div>
      )}
      {wired && !snap.error && snap.data && <Body data={snap.data} />}
      {wired && !snap.error && !snap.data && (
        <div className="mt-6 text-xs text-neutral-500">Loading…</div>
      )}
    </>
  );
}

function Body({ data }: { data: FinOpsSnapshot }) {
  const redFlags = data.redFlags ?? [];
  return (
    <div className="mt-6 flex flex-col gap-8">
      {redFlags.length > 0 && <RedFlags flags={redFlags} />}
      <Lede />
      <PenaltyBucketExplainer />
      <PostureSummary data={data} />
      <KeyMetrics data={data} />
      <CapacityMixSection data={data} />
      <PenaltyDistributionSection data={data} />
      <DemandVsSupplySection data={data} />
      <DecisionEngineSection data={data} />
      <Glossary />
    </div>
  );
}

// ─── Lede ──────────────────────────────────────────────────────────────────

function Lede() {
  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 p-5 text-sm leading-relaxed">
      <p className="text-neutral-700 dark:text-neutral-300">
        BigFleet provisions machines through pluggable capacity providers and routes workloads to them based on a
        fixed cost formula: <code className="font-mono text-xs">effective_cost = price + interruption_probability × interruption_penalty</code>.
        That makes <strong>capacity type</strong> (bare-metal / reserved / on-demand / spot) and the workload's
        <strong> interruption penalty</strong> the two levers that decide where your money lands.
      </p>
      <p className="mt-3 text-neutral-700 dark:text-neutral-300">
        This page slices the live inventory along both axes so you can see at a glance whether the routing the engine
        actually did matches the routing your cost policy intended. Red flags appear at the top when those diverge.
      </p>
    </section>
  );
}

// ─── Penalty bucket explainer ─────────────────────────────────────────────

function PenaltyBucketExplainer() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-2">What is a penalty bucket?</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3 leading-relaxed">
        "Penalty bucket" is the unit every other chart on this page is sliced by, so the rest of the page won't make
        sense without it. Skim this once and the matrix below reads itself.
      </p>

      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 text-sm leading-relaxed">
        <p className="text-neutral-800 dark:text-neutral-200">
          Every <code className="font-mono text-xs">CapacityRequest</code> a workload submits carries an{" "}
          <code className="font-mono text-xs">interruptionPenalty</code> field — the workload owner's stated dollar cost
          of being killed mid-run. A trainer that would lose four hours of work if interrupted might declare{" "}
          <span className="font-mono">$4,096</span>; a stateless web pod that retries instantly might declare{" "}
          <span className="font-mono">$0</span>.
        </p>

        <p className="mt-3 text-neutral-800 dark:text-neutral-200">
          BigFleet quantises that raw dollar value into a bucket — <strong>powers of 2 from $0.50 to $8.4M</strong>,
          plus a <code className="font-mono text-xs">pinned</code> sentinel meaning "never interrupt me." Quantising
          caps the cross-cluster aggregation cardinality at 28 stable bucket labels instead of unbounded floats.
        </p>

        <div className="mt-4 rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-900/60 text-neutral-500 uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-3 py-2">Bucket</th>
                <th className="text-left font-medium px-3 py-2">Meaning</th>
                <th className="text-left font-medium px-3 py-2">Phase 1 routes toward</th>
                <th className="text-left font-medium px-3 py-2">Typical workload</th>
              </tr>
            </thead>
            <tbody className="text-neutral-700 dark:text-neutral-300">
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="font-mono px-3 py-2 align-top">$0</td>
                <td className="px-3 py-2 align-top">Free to interrupt — retry is cheap.</td>
                <td className="px-3 py-2 align-top">Whatever is literally cheapest, including Spot.</td>
                <td className="px-3 py-2 align-top text-neutral-500">Stateless web, idempotent batch.</td>
              </tr>
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="font-mono px-3 py-2 align-top">$0.50 – $32</td>
                <td className="px-3 py-2 align-top">Restart has real but small cost.</td>
                <td className="px-3 py-2 align-top">Spot still OK; OnDemand wins if Spot's interruption probability is non-trivial.</td>
                <td className="px-3 py-2 align-top text-neutral-500">Short-running CI jobs.</td>
              </tr>
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="font-mono px-3 py-2 align-top">$64 – $1K</td>
                <td className="px-3 py-2 align-top">Hours of work lost on interrupt.</td>
                <td className="px-3 py-2 align-top">Routes away from Spot toward OnDemand / Reserved.</td>
                <td className="px-3 py-2 align-top text-neutral-500">Long-running services, modest training.</td>
              </tr>
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="font-mono px-3 py-2 align-top">$1K – $1M</td>
                <td className="px-3 py-2 align-top">Expensive to restart (SLA breach, retraining cost).</td>
                <td className="px-3 py-2 align-top">Pulls strongly toward Reserved or BareMetal.</td>
                <td className="px-3 py-2 align-top text-neutral-500">Large-model training, customer-facing services with tight SLOs.</td>
              </tr>
              <tr className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="font-mono px-3 py-2 align-top">
                  <span className="inline-block px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">pinned</span>
                </td>
                <td className="px-3 py-2 align-top">Cannot be interrupted, ever.</td>
                <td className="px-3 py-2 align-top">Spot is forbidden by Phase 1. Reserved / OnDemand / BareMetal only.</td>
                <td className="px-3 py-2 align-top text-neutral-500">Stateful databases, in-flight payment processing.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-neutral-800 dark:text-neutral-200">
          The penalty enters BigFleet's fixed cost formula:
        </p>
        <pre className="mt-2 rounded-md bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 p-3 text-xs font-mono overflow-x-auto">
          effective_cost = price + (interruption_probability × interruption_penalty)
        </pre>
        <p className="mt-3 text-neutral-800 dark:text-neutral-200">
          The provider declares the <em>price</em> and <em>interruption_probability</em> of each tier; the workload
          declares the <em>interruption_penalty</em>. Phase 1 minimises <em>effective_cost</em> per Need.
        </p>

        <div className="mt-4 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 p-3 text-xs leading-relaxed text-blue-900 dark:text-blue-200">
          <div className="font-semibold mb-1">Worked example</div>
          A trainer job declaring <span className="font-mono">$4,096</span> penalty considers a Spot machine at{" "}
          <span className="font-mono">$0.50/hr</span> with a typical Spot interruption_probability of{" "}
          <span className="font-mono">0.05</span>:
          <div className="mt-1 font-mono">effective_cost = $0.50 + 0.05 × $4096 = $205.30/hr</div>
          An OnDemand machine at <span className="font-mono">$1/hr</span> with{" "}
          <span className="font-mono">0.00</span> interruption_probability:
          <div className="mt-1 font-mono">effective_cost = $1.00 + 0.00 × $4096 = $1.00/hr</div>
          Phase 1 picks OnDemand. That's why bucket distribution and capacity-type distribution have to be read
          together — a high bucket is the workload <em>asking</em> the engine to skip cheap-but-flaky capacity.
        </div>

        <p className="mt-4 text-neutral-700 dark:text-neutral-300 text-xs">
          <strong>Who sets the penalty:</strong> usually the operator chart's PriorityClass → penalty mapping (e.g.{" "}
          <code className="font-mono">ml-research</code> defaults to <span className="font-mono">$8,192</span>;{" "}
          <code className="font-mono">batch-low</code> to <span className="font-mono">$1</span>). Power users override
          per-workload via the <code className="font-mono">interruptionPenalty</code> field on{" "}
          <code className="font-mono">CapacityRequest</code> or the{" "}
          <code className="font-mono">bigfleet.lucy.sh/interruption-penalty</code> Pod annotation. Per-cluster defaults
          are picked when neither is set.
        </p>

        <p className="mt-3 text-neutral-500 text-xs">
          Note: there's a second penalty —{" "}
          <code className="font-mono">reclamationPenalty</code> — that's tied to the <em>specific machine</em> (accrued
          training state, warm caches). The dashboard slices on <em>interruption</em> penalty because that's what
          drives Phase 1's routing; reclamation penalty matters for Phase 2 / Phase 3 tiebreaks.
        </p>
      </div>
    </section>
  );
}

// ─── Posture summary ──────────────────────────────────────────────────────

function PostureSummary({ data }: { data: FinOpsSnapshot }) {
  const totals = data.totals;
  const total = totals.configuredMachines + totals.idleMachines;
  const idleFrac = total > 0 ? totals.idleMachines / total : 0;
  const demandOverCapacity = totals.demandMachines > total;

  const mix = data.capacityTypes
    .map((ct) => ({
      ct,
      configured: data.configuredByCapacityType[ct] ?? 0,
      idle: data.idleByCapacityType[ct] ?? 0,
    }))
    .filter((r) => r.configured + r.idle > 0)
    .sort((a, b) => b.configured + b.idle - (a.configured + a.idle));

  // Top capacity-type narrative
  const mixDesc =
    mix.length === 0
      ? "no inventory yet."
      : mix.length === 1
      ? `100 % on ${mix[0]!.ct} capacity.`
      : mix
          .slice(0, 4)
          .map(({ ct, configured, idle }) => {
            const pct = total > 0 ? ((configured + idle) / total) * 100 : 0;
            return `${pct.toFixed(0)} % ${ct}`;
          })
          .join(", ") + ".";

  const sentences: string[] = [];
  sentences.push(`Your fleet currently holds ${formatInt(total)} machines — ${mixDesc}`);
  if (totals.configuredMachines > 0) {
    sentences.push(
      `${formatInt(totals.configuredMachines)} are actively serving workloads; ${formatInt(
        totals.idleMachines
      )} sit idle as headroom (${formatPercent(idleFrac, 0)} of the fleet).`
    );
  }
  if (totals.demandMachines > 0) {
    sentences.push(
      demandOverCapacity
        ? `Workload demand currently exceeds total capacity (${formatInt(totals.demandMachines)} requested vs ${formatInt(total)} available) — Phase 1 will be provisioning or preempting to close the gap.`
        : `Workload demand is ${formatInt(totals.demandMachines)} machines, comfortably under capacity.`
    );
  }
  if (totals.spotConfiguredFraction > 0) {
    sentences.push(
      `${formatPercent(totals.spotConfiguredFraction, 0)} of Configured capacity is on Spot — the cheapest tier, at the cost of interruptibility.`
    );
  }
  if (totals.pinnedConfiguredFraction > 0) {
    sentences.push(
      `${formatPercent(totals.pinnedConfiguredFraction, 1)} of Configured capacity carries Pinned (never-interrupt) workloads.`
    );
  }
  if ((data.redFlags ?? []).length === 0 && totals.configuredMachines > 0) {
    sentences.push("No FinOps red flags right now — Phase 1's routing matches the penalty buckets it was given.");
  }

  return (
    <section>
      <h2 className="text-base font-semibold mb-2">Fleet posture</h2>
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
        {sentences.map((s, i) => (
          <p key={i} className={i > 0 ? "mt-2" : ""}>
            {s}
          </p>
        ))}
      </div>
    </section>
  );
}

// ─── Key metrics ───────────────────────────────────────────────────────────

function KeyMetrics({ data }: { data: FinOpsSnapshot }) {
  const totals = data.totals;
  const total = totals.configuredMachines + totals.idleMachines;
  const idleFrac = total > 0 ? totals.idleMachines / total : 0;
  const spotTone = totals.spotConfiguredFraction > 0.5 ? "warn" : "neutral";
  const pinnedTone = totals.pinnedConfiguredFraction > 0.05 ? "warn" : "neutral";
  const demandTone = totals.demandMachines > total ? "danger" : "neutral";

  return (
    <section>
      <h2 className="text-base font-semibold mb-2">Key numbers</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
        The headline of your fleet, derived from the queries below.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile
          label="Active machines"
          value={formatInt(totals.configuredMachines)}
          subtitle="serving workloads (Configured)"
        />
        <Tile
          label="Idle headroom"
          value={formatInt(totals.idleMachines)}
          subtitle={total > 0 ? `${formatPercent(idleFrac, 0)} of fleet` : undefined}
        />
        <Tile
          label="Workload demand"
          value={formatInt(totals.demandMachines)}
          subtitle="machines worth of unfulfilled or running requests"
          tone={demandTone}
        />
        <Tile
          label="Spot share"
          value={formatPercent(totals.spotConfiguredFraction)}
          subtitle="of active capacity is interruptible"
          tone={spotTone}
        />
        <Tile
          label="Pinned share"
          value={formatPercent(totals.pinnedConfiguredFraction)}
          subtitle="never-interrupt workloads"
          tone={pinnedTone}
        />
      </div>
    </section>
  );
}

// ─── Capacity mix ──────────────────────────────────────────────────────────

function CapacityMixSection({ data }: { data: FinOpsSnapshot }) {
  const rows = data.capacityTypes
    .map((ct) => ({
      ct,
      configured: data.configuredByCapacityType[ct] ?? 0,
      idle: data.idleByCapacityType[ct] ?? 0,
      colour: colourFor(capacityTypeColours, ct, data.capacityTypes.indexOf(ct)),
    }))
    .filter((r) => r.configured + r.idle > 0);

  const configuredSegs = rows
    .filter((r) => r.configured > 0)
    .map((r) => ({ label: r.ct, value: r.configured, colour: r.colour }));
  const idleSegs = rows
    .filter((r) => r.idle > 0)
    .map((r) => ({ label: r.ct, value: r.idle, colour: r.colour }));

  return (
    <Section
      title="Capacity mix"
      lede="Which provisioning tiers your money is on. BigFleet treats all four tiers as a single pool and prices them by `effective_cost`; you choose the mix by what you let your providers offer."
      promql='sum by (capacity_type) (bigfleet_shard_inventory_machines{state=~"Configured|Idle"})'
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Active (Configured)</div>
          <StackedBar segments={configuredSegs} formatValue={(v) => formatInt(v)} />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Idle headroom</div>
          <StackedBar segments={idleSegs} formatValue={(v) => formatInt(v)} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {(["BareMetal", "Reserved", "OnDemand", "Spot"] as const).map((ct) => {
          const r = rows.find((x) => x.ct === ct);
          const conf = r?.configured ?? 0;
          const idle = r?.idle ?? 0;
          const sum = conf + idle;
          return (
            <div
              key={ct}
              className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: capacityTypeColours[ct] ?? "#888" }}
                />
                <span className="font-mono">{ct}</span>
              </div>
              <div className="mt-1 text-base tabular-nums">{formatInt(sum)}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500">
                {formatInt(conf)} active · {formatInt(idle)} idle
              </div>
              <p className="mt-2 text-[11px] text-neutral-500 leading-snug">{capacityTypeDescription(ct)}</p>
            </div>
          );
        })}
      </div>

      <Interpretation
        title="What to look for"
        items={[
          "A fleet that's 100 % BareMetal or 100 % OnDemand is leaving cost on the table — most production fleets blend Reserved (predictable baseline) + OnDemand (burst) + Spot (cheap-but-interruptible).",
          "If Spot share is high but you also have lots of high-penalty workloads, the engine is making the right call — but reconcile this with the penalty matrix below to confirm the high-penalty ones aren't on Spot.",
          "Heavy Idle on one tier and Active on another suggests Phase 3's reclamation pressure is dropping the wrong capacity first.",
        ]}
      />
    </Section>
  );
}

function capacityTypeDescription(ct: string): string {
  switch (ct) {
    case "BareMetal":
      return "Fixed inventory. Free at the margin — already paid for.";
    case "Reserved":
      return "Committed cloud capacity. Discounted, never interrupted.";
    case "OnDemand":
      return "Pay-per-hour cloud. No commitment, no interruption.";
    case "Spot":
      return "Cheapest cloud tier. Can be reclaimed with short notice.";
    default:
      return "Custom provider tier.";
  }
}

// ─── Penalty distribution ─────────────────────────────────────────────────

function PenaltyDistributionSection({ data }: { data: FinOpsSnapshot }) {
  const max = useMemo(() => {
    let m = 0;
    for (const ct of data.capacityTypes) {
      const row = data.configured[ct] ?? {};
      for (const b of data.buckets) {
        const v = row[b] ?? 0;
        if (v > m) m = v;
      }
    }
    return m;
  }, [data]);

  // Summary stats: top buckets by count, total configured covered.
  const totalConfigured = Object.values(data.configuredByBucket ?? {}).reduce((s, v) => s + v, 0);
  const sortedBuckets = Object.entries(data.configuredByBucket ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const top3 = sortedBuckets.slice(0, 3);
  const highPenalty = sortedBuckets
    .filter(([b]) => {
      if (b === "pinned") return true;
      const n = Number(b);
      return isFinite(n) && n >= 1024;
    })
    .reduce((s, [, v]) => s + v, 0);
  const highPenaltyFrac = totalConfigured > 0 ? highPenalty / totalConfigured : 0;

  return (
    <Section
      title="Penalty distribution"
      lede="Each workload declares an interruption penalty (in dollars). The engine quantises that to a power-of-2 bucket from $0.50 to $8.4M, plus a `pinned` sentinel for never-interrupt jobs. The matrix below maps capacity-type × penalty-bucket of your Configured inventory — where high-penalty rows land tells you whether the engine routed them away from interruptible capacity."
      promql={`sum by (capacity_type, interruption_penalty_bucket) (bigfleet_shard_inventory_machines{state="Configured"})`}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Tile
          label="Top bucket"
          value={top3[0] ? formatPenaltyBucket(top3[0][0]) : "—"}
          subtitle={top3[0] ? `${formatInt(top3[0][1])} machines` : undefined}
        />
        <Tile
          label="High-penalty share (≥$1K)"
          value={formatPercent(highPenaltyFrac, 0)}
          subtitle={`${formatInt(highPenalty)} of ${formatInt(totalConfigured)} configured`}
        />
        <Tile
          label="Pinned machines"
          value={formatInt(data.configuredByBucket?.["pinned"] ?? 0)}
          subtitle="held by never-interrupt workloads"
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="text-xs border-separate border-spacing-px">
          <thead className="bg-neutral-50 dark:bg-neutral-900/60">
            <tr>
              <th className="sticky left-0 bg-neutral-50 dark:bg-neutral-900/60 text-left font-medium text-neutral-500 px-2 py-1">
                capacity_type \\ bucket
              </th>
              {data.buckets.map((b) => (
                <th key={b} className="font-mono text-neutral-500 px-2 py-1 text-right whitespace-nowrap">
                  {formatPenaltyBucket(b)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.capacityTypes.map((ct) => (
              <tr key={ct}>
                <th className="sticky left-0 bg-white dark:bg-neutral-900 text-left font-mono font-medium px-2 py-1 whitespace-nowrap">
                  {ct}
                </th>
                {data.buckets.map((b) => (
                  <MatrixCell
                    key={b}
                    value={data.configured[ct]?.[b] ?? 0}
                    max={max}
                    flagged={ct === "Spot" && b === "pinned" && (data.configured[ct]?.[b] ?? 0) > 0}
                  />
                ))}
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 bg-white dark:bg-neutral-900 text-left font-mono font-medium text-neutral-500 px-2 py-1 whitespace-nowrap border-t border-neutral-200 dark:border-neutral-800">
                demand
              </th>
              {data.buckets.map((b) => {
                const v = data.demand[b] ?? 0;
                return (
                  <td
                    key={b}
                    className="text-right tabular-nums px-2 py-1 font-mono border-t border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300"
                  >
                    {v > 0 ? formatInt(v) : ""}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <Interpretation
        title="How to read this"
        items={[
          "Each cell is a count of machines. Darker blue = higher count within the matrix. Read across a row to see how one capacity tier is split across penalty levels; read down a column to see how one penalty bucket is split across tiers.",
          "The bottom 'demand' row is independent: it's what the workloads are currently asking for, before any allocation.",
          "Red border on Spot × Pinned is the canonical red flag — Phase 1 should never put a Pinned workload on Spot. If you see it, check the provider's `interruption_probability` and the operator's PriorityClass → penalty mapping.",
          "Empty cells render as `·`. An entirely empty column means no workloads are currently in that penalty band.",
        ]}
      />
    </Section>
  );
}

function MatrixCell({ value, max, flagged }: { value: number; max: number; flagged: boolean }) {
  const intensity = max > 0 ? Math.min(1, value / max) : 0;
  if (flagged) {
    const opacity = 0.25 + intensity * 0.6;
    return (
      <td
        className="text-right tabular-nums px-2 py-1 font-mono text-red-900 dark:text-red-100 border border-red-400 dark:border-red-500"
        style={{ backgroundColor: `rgba(220, 38, 38, ${opacity.toFixed(3)})` }}
        title="Pinned-penalty workloads on Spot capacity — Phase 1 misallocation"
      >
        {formatInt(value)}
      </td>
    );
  }
  if (value === 0) {
    return <td className="text-right tabular-nums px-2 py-1 text-neutral-300 dark:text-neutral-700 font-mono">·</td>;
  }
  const opacity = 0.08 + intensity * 0.65;
  return (
    <td
      className="text-right tabular-nums px-2 py-1 font-mono text-neutral-900 dark:text-neutral-100"
      style={{ backgroundColor: `rgba(59, 130, 246, ${opacity.toFixed(3)})` }}
    >
      {formatInt(value)}
    </td>
  );
}

// ─── Demand vs supply ──────────────────────────────────────────────────────

function DemandVsSupplySection({ data }: { data: FinOpsSnapshot }) {
  const rows = data.buckets
    .map((b) => ({
      bucket: b,
      demand: data.demand[b] ?? 0,
      supply: data.configuredByBucket[b] ?? 0,
    }))
    .filter((r) => r.demand > 0 || r.supply > 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.demand, r.supply]));

  const short = rows.filter((r) => r.supply < r.demand);
  const over = rows.filter((r) => r.supply > r.demand * 2 && r.demand > 0);

  return (
    <Section
      title="Demand vs supply by penalty bucket"
      lede="Per penalty bracket, amber is what's being asked for, blue is what's actually configured. The right-hand number is the signed gap (supply − demand). This is the closest the dashboard gets to answering 'are we paying for the right thing?' — recall from the explainer above that bigger buckets are workloads that have asked Phase 1 to keep them off interruptible tiers, so under-supply at a high bucket is more expensive to ignore than under-supply at $0."
      promql='Demand: sum by (interruption_penalty_bucket) (bigfleet_shard_demand_machines) · Supply: sum by (interruption_penalty_bucket) (bigfleet_shard_inventory_machines{state="Configured"})'
    >
      {rows.length === 0 ? (
        <div className="text-xs text-neutral-500">no demand or configured supply</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[80px_1fr_80px] items-center gap-3 text-[10px] uppercase tracking-wide text-neutral-500">
            <div className="text-right">Bucket</div>
            <div>
              <span className="inline-flex items-center gap-1 mr-3">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: "#f59e0b" }} />
                demand
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ backgroundColor: "#3b82f6" }} />
                supply
              </span>
            </div>
            <div className="text-right">Gap</div>
          </div>
          {rows.map((r) => {
            const gap = r.supply - r.demand;
            const gapTone =
              gap < 0
                ? "text-red-600 dark:text-red-400"
                : gap > r.demand * 2
                ? "text-amber-600 dark:text-amber-400"
                : "text-neutral-500";
            return (
              <div
                key={r.bucket}
                className="grid grid-cols-[80px_1fr_80px] items-center gap-3 text-xs"
              >
                <div className="font-mono text-neutral-500 text-right">{formatPenaltyBucket(r.bucket)}</div>
                <div className="space-y-0.5">
                  <Bar value={r.demand} max={max} colour="#f59e0b" label={`demand ${formatInt(r.demand)}`} />
                  <Bar value={r.supply} max={max} colour="#3b82f6" label={`supply ${formatInt(r.supply)}`} />
                </div>
                <div className={`font-mono tabular-nums text-right ${gapTone}`}>
                  {gap === 0 ? "" : `${gap > 0 ? "+" : ""}${formatInt(gap)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Interpretation
        title="How to read this"
        items={[
          `Red gap (supply < demand) means BigFleet is currently short on that bucket. ${short.length > 0 ? `Today: ${short.map((r) => formatPenaltyBucket(r.bucket)).join(", ")}.` : "None right now."}`,
          `Amber gap (supply ≫ demand) means you're holding more than you currently need at that bucket — fine for headroom, but watch for sustained over-provisioning. ${over.length > 0 ? `Today: ${over.map((r) => formatPenaltyBucket(r.bucket)).join(", ")}.` : "None right now."}`,
          "Steady-state aim: supply tracks demand at every active bucket, with a small positive idle cushion.",
        ]}
      />
    </Section>
  );
}

function Bar({ value, max, colour, label }: { value: number; max: number; colour: string; label: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1 rounded-sm bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: colour }} title={label} />
      </div>
    </div>
  );
}

// ─── Decision engine activity ─────────────────────────────────────────────

function DecisionEngineSection({ data }: { data: FinOpsSnapshot }) {
  const rates = data.actionRatesPerSec ?? {};
  const reclaim = rates["Reclaim"] ?? 0;
  const preempt = rates["Preempt"] ?? 0;
  const bootstrap = rates["Bootstrap"] ?? 0;
  const provision = rates["Provision"] ?? 0;
  const reclaimTone = reclaim > 1 ? "warn" : "neutral";
  const preemptTone = preempt > 0.1 ? "warn" : "neutral";

  return (
    <Section
      title="Decision-engine activity"
      lede="The shard runs four kinds of action every cycle. Sustained Bootstrap / Provision = workloads are arriving; sustained Reclaim / Preempt = the cost-policy is fighting the workload mix and you're paying for it."
      promql="sum by (kind) (rate(bigfleet_shard_actions_total[5m]))"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Bootstrap" value={formatRate(bootstrap)} subtitle="bind workload to existing machine" />
        <Tile label="Provision" value={formatRate(provision)} subtitle="ask provider for a new machine" />
        <Tile label="Reclaim" value={formatRate(reclaim)} subtitle="release a Configured machine" tone={reclaimTone} />
        <Tile
          label="Preempt"
          value={formatRate(preempt)}
          subtitle="evict a low-priority workload to make room"
          tone={preemptTone}
        />
      </div>

      <Interpretation
        title="What rates mean for cost"
        items={[
          "Bootstrap and Provision are normal — every new pod that triggers a CR produces at least a Bootstrap. Cost is amortised over the workload's lifetime.",
          "Reclaim is the engine returning excess inventory. Healthy in trickles; a sustained high rate means you're churning machines you just paid to provision, which eats the amortisation. >1/s is the warn threshold for laptop-scale demos; production fleets should be much closer to zero in steady state.",
          "Preempt eats real money: an in-flight workload was killed mid-run. >0.1/s is suspicious. Usually means workload priorities are mis-set so high-priority demand is bumping things that probably could have run on cheaper capacity.",
        ]}
      />
    </Section>
  );
}

// ─── Glossary ──────────────────────────────────────────────────────────────

function Glossary() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-left text-sm font-semibold"
      >
        <span>Glossary</span>
        <span className="text-neutral-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <dl className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {GLOSSARY.map(({ term, body }) => (
            <div key={term}>
              <dt className="font-mono text-xs uppercase tracking-wide text-neutral-500">{term}</dt>
              <dd className="mt-0.5 text-neutral-700 dark:text-neutral-300">{body}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

const GLOSSARY: { term: string; body: string }[] = [
  { term: "Configured", body: "Machine has joined a cluster and is running workloads. The state you pay for." },
  { term: "Idle", body: "Machine is provisioned and real, but not joined to any cluster. Held as headroom." },
  { term: "Speculative", body: "Quota slot. No real hardware yet — the provider can create one on demand." },
  { term: "Demand", body: "Aggregate workload-machine equivalent that operators have asked for via the roll-up." },
  {
    term: "Capacity type",
    body: "Provisioning tier of a machine: BareMetal, Reserved, OnDemand, or Spot. Drives `price` in the cost formula.",
  },
  {
    term: "Interruption penalty",
    body: "Dollar cost a workload declares for being interrupted. Quantised to powers of 2 ($0.50 → $8.4M, plus `pinned`).",
  },
  {
    term: "Penalty bucket",
    body: "The quantised dollar bracket. Stable label values keep cross-cluster aggregation cardinality bounded.",
  },
  { term: "Pinned", body: "Sentinel penalty bucket. Phase 1 will never run a Pinned workload on interruptible capacity." },
  {
    term: "Reclamation penalty",
    body: "Dollar cost tied to a *specific machine* (long-running state, accumulated cache). Distinct from interruption penalty.",
  },
  { term: "Effective cost", body: "`price + interruption_probability × interruption_penalty`. The single number Phase 1 minimises." },
  { term: "Phase 1 / 2 / 3", body: "Per-cycle decision phases: assign idle / preempt inversions / reclaim excess." },
  { term: "Bootstrap", body: "Action: bind a workload to an existing machine." },
  { term: "Provision", body: "Action: ask the provider for a new machine." },
  { term: "Reclaim", body: "Action: take a Configured machine back to Idle." },
  { term: "Preempt", body: "Action: evict a low-priority workload to make room for a higher-priority one." },
  { term: "Shortfall", body: "Demand the shard couldn't satisfy this cycle. Aged and escalated if not cleared." },
];

// ─── Shared layout primitives ──────────────────────────────────────────────

function Section({
  title,
  lede,
  promql,
  children,
}: {
  title: string;
  lede: string;
  promql?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{lede}</p>
        {promql && (
          <p className="mt-1.5 text-xs font-mono text-neutral-400 dark:text-neutral-500 break-all">{promql}</p>
        )}
      </header>
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        {children}
      </div>
    </section>
  );
}

function Interpretation({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4 rounded-md bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1.5">{title}</div>
      <ul className="space-y-1 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed list-disc list-inside">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function RedFlags({ flags }: { flags: FinOpsRedFlag[] }) {
  return (
    <section className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-700/50 p-4">
      <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
        {flags.length === 1 ? "1 red flag" : `${flags.length} red flags`}
      </h2>
      <ul className="mt-2 space-y-2">
        {flags.map((f, i) => (
          <li key={i} className="text-sm text-red-900 dark:text-red-200">
            <span className="font-mono">
              {f.capacityType} / {formatPenaltyBucket(f.bucket)}
            </span>
            <span className="text-red-700 dark:text-red-300/80"> · {formatInt(f.count)} machines</span>
            <p className="mt-0.5 text-xs text-red-800 dark:text-red-300/90">{f.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
