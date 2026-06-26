import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import GrafanaPanel, { GrafanaLink } from "./GrafanaPanel";

describe("GrafanaPanel", () => {
  it("renders nothing when grafanaUrl is unset", () => {
    const { container } = render(<GrafanaPanel grafanaUrl={undefined} uid="u" panelId={2} />);
    expect(container.firstChild).toBeNull();
  });

  it("builds a d-solo iframe src (trailing slash trimmed) when grafanaUrl is set", () => {
    const { container } = render(
      <GrafanaPanel grafanaUrl="https://grafana.example.com/" uid="bigfleet-scaletest" panelId={2} title="CR creates" />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const src = iframe?.getAttribute("src") ?? "";
    expect(src).toContain("https://grafana.example.com/d-solo/bigfleet-scaletest/");
    expect(src).toContain("panelId=2");
    expect(src).toContain("theme=");
  });
});

describe("GrafanaLink", () => {
  it("renders nothing when grafanaUrl is unset", () => {
    const { container } = render(<GrafanaLink grafanaUrl={undefined} uid="u" />);
    expect(container.firstChild).toBeNull();
  });

  it("deep-links to the full dashboard", () => {
    const { container } = render(<GrafanaLink grafanaUrl="https://g.example/" uid="bigfleet-scaletest" slug="s" />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://g.example/d/bigfleet-scaletest/s");
  });
});
