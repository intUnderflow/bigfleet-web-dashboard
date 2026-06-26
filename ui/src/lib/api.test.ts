import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./api";

function okJSON(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("api getJSON", () => {
  it("returns the parsed body on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJSON({ status: "ok" })));
    await expect(api.health()).resolves.toEqual({ status: "ok" });
  });

  it("uses root-absolute paths for a standalone build", async () => {
    const f = vi.fn().mockResolvedValue(okJSON({ status: "ok" }));
    vi.stubGlobal("fetch", f);
    await api.health();
    expect(f).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("prefixes requests with the build-time base path behind a proxy", async () => {
    vi.stubEnv("BASE_URL", "/fleet-dash/");
    const f = vi.fn().mockResolvedValue(okJSON({ status: "ok" }));
    vi.stubGlobal("fetch", f);
    await api.health();
    expect(f).toHaveBeenCalledWith("/fleet-dash/api/health", expect.anything());
  });

  it("throws the error-envelope message on a non-2xx with a JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({ error: "coordinator not configured: pass --coordinator-addr" }),
      } as Response),
    );
    await expect(api.topology()).rejects.toThrow("coordinator not configured");
  });

  it("falls back to status text when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response),
    );
    await expect(api.topology()).rejects.toThrow("502 Bad Gateway");
  });
});
