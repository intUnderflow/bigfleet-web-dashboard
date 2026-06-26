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

// uPlot calls matchMedia at module init (devicePixelRatio tracking); jsdom
// doesn't provide it. Stub a no-op MediaQueryList so importing Sparkline works.
if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof globalThis.matchMedia;
}
