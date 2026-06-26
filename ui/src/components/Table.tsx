import type { ReactNode } from "react";

/** Token-styled table primitives shared across the list/report pages so they
 *  stay visually consistent. Wrap with TableShell; build with THead/TH/TR/TD. */

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </section>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
      {children}
    </thead>
  );
}

export function TH({ children, right = false }: { children?: ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2.5 font-semibold ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function TR({
  children,
  hover = false,
  className = "",
}: {
  children: ReactNode;
  hover?: boolean;
  className?: string;
}) {
  return (
    <tr
      className={`border-b border-[var(--border)] last:border-0 ${
        hover ? "transition-colors hover:bg-[var(--surface-2)]" : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  right = false,
  mono = false,
  muted = false,
  className = "",
  colSpan,
  title,
}: {
  children: ReactNode;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={`px-4 py-2.5 ${right ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""} ${
        muted ? "text-[var(--text-muted)]" : "text-[var(--text)]"
      } ${className}`}
    >
      {children}
    </td>
  );
}

/** A full-width centered message row (loading / empty). */
export function MessageRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
        {children}
      </td>
    </tr>
  );
}
