import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: "neutral" | "warn" | "danger";
}

const toneClasses = {
  neutral: "",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
} as const;

export default function Tile({ label, value, subtitle, tone = "neutral" }: Props) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>{value}</div>
      {subtitle && (
        <div className="mt-1 text-xs text-neutral-500 truncate">{subtitle}</div>
      )}
    </div>
  );
}
