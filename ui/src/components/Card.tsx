import type { ReactNode } from "react";

/** A titled surface section. `subtitle` renders as a small mono caption
 *  (handy for the PromQL / RPC each card is backed by). `right` is an
 *  optional header-aligned slot for actions. */
export default function Card({
  title,
  subtitle,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] ${className}`}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-subtle)]">{subtitle}</p>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}
