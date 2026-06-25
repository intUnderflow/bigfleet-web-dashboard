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
