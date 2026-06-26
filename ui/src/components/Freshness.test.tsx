import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Freshness from "./Freshness";

describe("Freshness", () => {
  it("shows the rebuilding/no-data state for a zero timestamp", () => {
    const { container } = render(<Freshness unixNanos={0} />);
    expect(container.textContent).toMatch(/rebuilding/i);
  });

  it("shows a custom empty label", () => {
    const { container } = render(<Freshness unixNanos={0} emptyLabel="no cycle yet" />);
    expect(container.textContent).toContain("no cycle yet");
  });

  it("flags staleness past the threshold", () => {
    const oldNanos = (Date.now() / 1000 - 120) * 1e9;
    const { container } = render(<Freshness unixNanos={oldNanos} staleAfterSec={20} />);
    expect(container.textContent).toContain("(stale)");
  });

  it("does not flag a fresh timestamp, and shows the cycle", () => {
    const recentNanos = (Date.now() / 1000 - 2) * 1e9;
    const { container } = render(<Freshness unixNanos={recentNanos} cycle={42} staleAfterSec={20} />);
    expect(container.textContent).not.toContain("(stale)");
    expect(container.textContent).toContain("cycle 42");
  });
});
