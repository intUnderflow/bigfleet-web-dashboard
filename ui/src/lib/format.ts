export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1e-3) return `${Math.round(seconds * 1e6)} µs`;
  if (seconds < 1) return `${Math.round(seconds * 1e3)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s}s`;
}

export function formatInt(n: number | undefined | null): string {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

export function formatRate(perSec: number | undefined | null): string {
  if (perSec == null || !isFinite(perSec)) return "—";
  if (perSec === 0) return "0/s";
  if (perSec < 0.01) return `${(perSec * 60).toFixed(2)}/min`;
  return `${perSec.toFixed(2)}/s`;
}

export function formatPenaltyBucket(b: string): string {
  if (b === "pinned") return "Pinned";
  if (b === "unspecified") return "unspec.";
  const n = Number(b);
  if (!isFinite(n)) return b;
  if (n === 0) return "$0";
  if (n < 1) return `$${n}`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`;
  return `$${n}`;
}

// ── Kubernetes resource quantities ────────────────────────────────────────
// The wire carries canonical k8s quantities — CPU in millicores ("278500m"),
// memory in binary bytes ("10880Mi"). Operators think in cores and GiB, so we
// humanize for display and keep the raw string available on hover.

function trimNum(n: number, dp = 2): string {
  if (!isFinite(n)) return "0";
  return n.toFixed(dp).replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
}

/** Short resource key: "nvidia.com/gpu" → "gpu", "example.com/foo" → "foo". */
export function shortResourceKey(k: string): string {
  return k.replace(/^nvidia\.com\//, "").replace(/^.*\//, "");
}

const BINARY_UNITS: [string, number][] = [
  ["Pi", 1024 ** 5],
  ["Ti", 1024 ** 4],
  ["Gi", 1024 ** 3],
  ["Mi", 1024 ** 2],
  ["Ki", 1024],
];
const QTY_SUFFIX: Record<string, number> = {
  "": 1, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15,
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5,
};

type QtyKind = "cpu" | "bytes" | "count";
function qtyKind(key: string, raw: string): QtyKind {
  const sk = shortResourceKey(key);
  if (sk === "cpu") return "cpu";
  if (sk === "memory" || sk.includes("storage")) return "bytes";
  if (/(Ki|Mi|Gi|Ti|Pi)$/.test(raw.trim())) return "bytes";
  return "count";
}

/** Numeric value of a k8s quantity in its base unit (cores for cpu, bytes for
 *  memory, integer count otherwise). Display-only; exactness isn't required. */
export function parseQuantity(s: string | undefined): number {
  if (!s) return 0;
  const m = /^([0-9.]+)\s*([a-zA-Z]*)$/.exec(s.trim());
  if (!m) return parseFloat(s) || 0;
  return (parseFloat(m[1]!) || 0) * (QTY_SUFFIX[m[2]!] ?? 1);
}

function fmtBytes(bytes: number): string {
  for (const [unit, mult] of BINARY_UNITS) {
    if (bytes >= mult) return `${trimNum(bytes / mult, 1)} ${unit}`;
  }
  return `${trimNum(bytes, 0)} B`;
}

/** Humanized value WITHOUT the resource name: "278.5", "10.6 Gi", "8". */
export function formatQuantityValue(key: string, raw: string | undefined): string {
  if (raw == null) return "—";
  switch (qtyKind(key, raw)) {
    case "cpu":
      return trimNum(parseQuantity(raw), 2);
    case "bytes":
      return fmtBytes(parseQuantity(raw));
    default:
      return trimNum(parseQuantity(raw), 2);
  }
}

/** Humanized quantity with its resource label: "278.5 cpu", "10.6 Gi",
 *  "8 gpu". Memory drops the word (the Gi/Mi unit is unambiguous). */
export function formatQuantity(key: string, raw: string | undefined): string {
  if (raw == null) return "—";
  const sk = shortResourceKey(key);
  const v = formatQuantityValue(key, raw);
  if (qtyKind(key, raw) === "bytes") return sk === "memory" ? v : `${v} ${sk}`;
  return `${v} ${sk}`;
}

/** Humanized resource map for inline demand strings: "278.5 cpu · 10.6 Gi". */
export function formatResources(m: Record<string, string> | undefined): string {
  if (!m) return "—";
  const parts = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  return parts.length ? parts.map(([k, v]) => formatQuantity(k, v)).join(" · ") : "—";
}

/** The exact raw quantities, for a title/tooltip: "cpu=278500m memory=10880Mi". */
export function rawResources(m: Record<string, string> | undefined): string {
  if (!m) return "";
  return Object.entries(m)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${shortResourceKey(k)}=${v}`)
    .join(" ");
}

// ── penalty buckets (powers-of-2 dollars, $0.50..$8.4M, then PINNED) ───────
// The wire carries the enum suffix: "UNSPECIFIED", "ZERO", "HALF_DOLLAR",
// "1", "2", … "8388608", "PINNED" (shardclient.shortBucket).

export const PENALTY_LADDER_MAX = 27; // PINNED's ordinal

/** Ordinal 0..27 of a penalty bucket, for the thermometer fill. UNSPECIFIED=0
 *  (unset), ZERO=1 ($0), HALF_DOLLAR=2, then 2^k buckets, PINNED=27. */
export function penaltyOrdinal(bucket: string | undefined): number {
  if (!bucket) return 0;
  const b = bucket.toUpperCase();
  if (b === "UNSPECIFIED" || b === "") return 0;
  if (b === "ZERO" || b === "$0") return 1;
  if (b === "HALF_DOLLAR" || b === "$0.50") return 2;
  if (b === "PINNED") return PENALTY_LADDER_MAX;
  const n = parseFloat(b.replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(Math.log2(n)) + 3; // "1"→3, "8192"→16, "8388608"→26
}

/** Operator-facing dollar label for a penalty bucket. UNSPECIFIED ("unset")
 *  is distinct from ZERO ("$0"). */
export function formatPenalty(bucket: string | undefined): string {
  if (!bucket) return "unset";
  const b = bucket.toUpperCase();
  if (b === "UNSPECIFIED") return "unset";
  if (b === "ZERO" || b === "$0") return "$0";
  if (b === "HALF_DOLLAR") return "$0.50";
  if (b === "PINNED") return "pinned";
  const n = parseFloat(b.replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return bucket;
  if (n >= 1e6) return `$${trimNum(n / 1e6, 1)}M`;
  if (n >= 1e3) return `$${trimNum(n / 1e3, 1)}K`;
  return `$${n.toLocaleString()}`;
}

/** Compact priority for tight columns: billions/millions abbreviated, smaller
 *  values (which operators compare exactly) left comma-grouped. */
export function formatPriorityCompact(p: number | undefined | null): string {
  if (p == null || !isFinite(p)) return "—";
  if (Math.abs(p) >= 1e9) return `${trimNum(p / 1e9, 1)}B`;
  if (Math.abs(p) >= 1e6) return `${trimNum(p / 1e6, 1)}M`;
  return Math.round(p).toLocaleString();
}

export function formatPercent(fraction: number | undefined | null, digits = 1): string {
  if (fraction == null || !isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatRelative(unixSec: number | undefined | null, nowSec: number = Date.now() / 1000): string {
  if (unixSec == null || unixSec <= 0 || !isFinite(unixSec)) return "—";
  const delta = nowSec - unixSec;
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86400)}d ago`;
}
