import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="text-sm">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-neutral-500">
        That route doesn't exist. <Link to="/" className="text-blue-600 underline">Back to overview</Link>.
      </p>
    </div>
  );
}
