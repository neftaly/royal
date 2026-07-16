import { describe, expect, it, vi } from "vitest";
import { scene, perspectiveCamera } from "@royal/renderer-core";
import { createRendererDiagnosticsStore } from "../packages/react/src/renderer-diagnostics";
import type { RoyalRendererDiagnosticsSnapshot } from "../packages/react/src/root";
import { fakeRendererRoot } from "./react-test-fixtures";

const emptyScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 2] }),
  nodes: [],
});

describe("React renderer diagnostics store", () => {
  it("retains unavailable state without an observer", () => {
    const store = createRendererDiagnosticsStore(null);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes diagnostics once after each later completed frame", () => {
    const root = fakeRendererRoot();
    let diagnostics = { marker: 1 } as unknown as RoyalRendererDiagnosticsSnapshot;
    vi.mocked(root.diagnostics).mockImplementation(() => diagnostics);
    const store = createRendererDiagnosticsStore(root);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe(diagnostics);
    expect(listener).not.toHaveBeenCalled();
    diagnostics = { marker: 2 } as unknown as RoyalRendererDiagnosticsSnapshot;
    root.render(emptyScene);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(diagnostics);

    unsubscribe();
    diagnostics = { marker: 3 } as unknown as RoyalRendererDiagnosticsSnapshot;
    root.render(emptyScene);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
