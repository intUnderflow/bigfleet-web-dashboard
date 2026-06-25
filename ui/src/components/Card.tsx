import type { ReactNode } from "react";

/** A titled bordered section. Shared by the topology / detail pages. */
export default function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500 font-mono mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
