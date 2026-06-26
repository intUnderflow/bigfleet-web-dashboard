import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger";
}

const toneText = {
  neutral: "text-[var(--text)]",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
} as const;

const toneAccent = {
  neutral: "bg-[var(--border-strong)]",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
} as const;

/** A single headline metric. A thin left rule carries the tone so a row of
 *  stats reads at a glance (green good / amber warn / red danger). */
export default function Tile({ label, value, subtitle, tone = "neutral" }: Props) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 shadow-[var(--shadow-sm)]">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${toneAccent[tone]}`} />
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">
        {label}
      </div>
      <div className={`mt-1 text-[26px] font-semibold leading-none tabular-nums ${toneText[tone]}`}>
        {value}
      </div>
      {subtitle && <div className="mt-1.5 truncate text-xs text-[var(--text-muted)]">{subtitle}</div>}
    </div>
  );
}
