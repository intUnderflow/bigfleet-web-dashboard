import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useSearchParamState } from "./useSearchParamState";

function Probe() {
  const [v, setV] = useSearchParamState("q", "def");
  return (
    <>
      <div data-testid="val">{v}</div>
      <button onClick={() => setV("hello")}>set</button>
      <button onClick={() => setV("def")}>clear</button>
    </>
  );
}

describe("useSearchParamState", () => {
  it("reads the initial query param", () => {
    render(
      <MemoryRouter initialEntries={["/?q=abc"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("val").textContent).toBe("abc");
  });

  it("falls back when the param is absent", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("val").textContent).toBe("def");
  });

  it("writes and clears the param", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Probe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByTestId("val").textContent).toBe("hello");
    fireEvent.click(screen.getByText("clear"));
    expect(screen.getByTestId("val").textContent).toBe("def");
  });
});
