import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver; stub it so layout-dependent libraries
// (@tanstack/react-virtual, uPlot) don't throw when rendered in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
