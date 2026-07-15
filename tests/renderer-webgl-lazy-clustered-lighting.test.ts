import { describe, expect, it, vi } from "vitest";
import { preloadClusteredLightingFeature } from "../packages/renderer-webgl/src/lazy-clustered-lighting-feature";
import { createWebGlRootWithResourcePolicy as createWebGlRoot } from "../packages/renderer-webgl/src/root";
import {
  clusteredScene,
  fakeCanvas,
  fakeGl,
} from "./renderer-webgl-working-state-runtime";

describe("lazy clustered-lighting feature", () => {
  it("defers punctual-lit draws until Forward+ is available", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = clusteredScene();

    root.render(graph);
    expect(calls.filter((call) => call.name === "drawElements")).toHaveLength(0);

    await preloadClusteredLightingFeature();
    await Promise.resolve();
    root.render(graph);
    root.render(graph);

    expect(calls.filter((call) => call.name === "drawElements").length).toBeGreaterThan(0);
    root.dispose();
    vi.unstubAllGlobals();
  });
});
