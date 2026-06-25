import type { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{subtitle}</p>
      )}
    </header>
  );
}
