import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="text-5xl font-semibold tracking-tight text-[var(--text-subtle)]">404</div>
      <h1 className="mt-3 text-lg font-semibold">Page not found</h1>
      <p className="mt-1.5 text-sm text-[var(--text-muted)]">
        That route doesn't exist.{" "}
        <Link to="/" className="font-medium text-[var(--accent)] hover:underline">
          Back to overview
        </Link>
        .
      </p>
    </div>
  );
}
