import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dashboard can serve standalone at "/" (default) or behind a reverse-proxy
// path prefix (e.g. /fleet-dash/) — its SPA uses root-absolute asset/API paths,
// so a <base href> can't relocate it; the prefix must be baked in at build
// time. Set BASE_PATH at build time; it flows to the asset URLs (here), the
// router basename (main.tsx), and the API fetch prefix (lib/api.ts), all via
// import.meta.env.BASE_URL. Assumes a prefix-stripping proxy (see README).
function normalizeBase(b: string | undefined): string {
  if (!b || b === "/") return "/";
  return "/" + b.replace(/^\/+|\/+$/g, "") + "/";
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
