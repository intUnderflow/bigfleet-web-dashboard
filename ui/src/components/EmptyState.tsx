import type { ReactNode } from "react";

/** A neutral, centered placeholder for "no data / loading / nothing matched"
 *  states. `tone="warn"` tints it amber for soft-state / rebuilding notices. */
export default function EmptyState({
  title,
  children,
  tone = "neutral",
}: {
  title: ReactNode;
  children?: ReactNode;
  tone?: "neutral" | "warn";
}) {
  const cls =
    tone === "warn"
      ? "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200"
      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]";
  return (
    <div className={`rounded-xl border border-dashed ${cls} px-6 py-10 text-center`}>
      <div className="text-sm font-medium text-[var(--text)]">{title}</div>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-[var(--text-muted)]">{children}</div>}
    </div>
  );
}
