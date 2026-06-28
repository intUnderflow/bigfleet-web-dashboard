import { useEffect, type ReactNode } from "react";

/** A right-side slide-over panel. Closes on Escape or overlay click.
 *  Renders nothing when closed. */
const sizeClass = { md: "max-w-md", lg: "max-w-2xl", xl: "max-w-3xl" } as const;

export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: keyof typeof sizeClass;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="bf-overlay absolute inset-0 bg-black/35 backdrop-blur-[1px]"
      />
      <div className={`bf-drawer relative flex h-full w-full ${sizeClass[size]} flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]`}>
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--text)]">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            aria-label="Close panel"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
