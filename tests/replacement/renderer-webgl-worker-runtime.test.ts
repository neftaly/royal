import { afterEach, expect, it, vi } from "vitest";
import { loadWorkerRuntime, workerScriptUrl } from "../../packages/renderer-webgl/src/workers/runtime";
afterEach(() => vi.unstubAllGlobals());
it("passes a consumer-resolved shared runtime URL into the worker", () => {
  const url = new URL(workerScriptUrl("https://example.test/assets/worker.js?asset=1"));
  expect(url.searchParams.get("asset")).toBe("1");
  expect(url.searchParams.get("royal-worker-runtime")).toContain("workerpool-runtime");
});
it("inherits the exact runtime URL in nested workers", () => {
  const runtime = "https://cdn.example.test/releases/one/runtime.js?v=2";
  vi.stubGlobal("location", { href: `https://example.test/assets/parent.js?royal-worker-runtime=${encodeURIComponent(runtime)}` });
  const url = new URL(workerScriptUrl("https://example.test/assets/draco.js"));
  expect(url.searchParams.get("royal-worker-runtime")).toBe(runtime);
});
it("rejects a worker with missing bootstrap configuration", () => {
  vi.stubGlobal("location", { href: "https://example.test/worker.js" });
  expect(() => loadWorkerRuntime()).toThrow("runtime URL is missing");
});
