import type { ReactNode } from "react";

export type Tone = "neutral" | "good" | "warn" | "danger" | "info" | "violet" | "accent";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-[var(--surface-3)] text-[var(--text-muted)]",
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  accent: "bg-[var(--accent-soft)] text-[var(--accent-soft-fg)]",
};

const dotColour: Record<Tone, string> = {
  neutral: "bg-[var(--text-subtle)]",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-sky-500",
  violet: "bg-violet-500",
  accent: "bg-[var(--accent)]",
};

/** A small status pill. With `dot`, a leading status dot is shown. */
export default function Badge({
  tone = "neutral",
  dot = false,
  mono = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
        mono ? "font-mono" : ""
      } ${toneClasses[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColour[tone]}`} />}
      {children}
    </span>
  );
}
