import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRendererRoot,
  type RoyalRendererDiagnosticsSnapshot,
} from "@royal/react";
import {
  perspectiveCamera,
  scene,
  type RenderRoot,
} from "@royal/renderer-core";
import { acquireExternalRenderClockForRoyalRoot } from "../packages/react/src/root";
import { forEachFuzzCase } from "./fuzz";
import { fakeCanvas } from "./react-test-fixtures";

const emptyScene = (): RenderRoot => scene({
  camera: perspectiveCamera({
    far: 10,
    fovY: Math.PI / 3,
    near: 0.1,
    position: [0, 0, 2],
    rotation: [0, 0, 0],
  }),
  nodes: [],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React root public API", () => {
  it("rejects malformed observer callbacks and glTF asset identities eagerly", () => {
    const root = createRendererRoot(fakeCanvas());
    const invalidCallback = null as unknown as () => void;

    expect(() => root.observeLifecycle(invalidCallback)).toThrow("observeLifecycle callback must be a function");
    expect(() => root.observeFrame(invalidCallback)).toThrow("observeFrame callback must be a function");
    expect(() => root.observeRenderFailures(invalidCallback)).toThrow("observeRenderFailures callback must be a function");
    expect(() => root.gltfAssetSnapshot(null as unknown as { uri: string })).toThrow(/gltfAssetSnapshot asset must be a GltfAssetRef object/i);
    expect(() => root.observeGltfAsset(
      { uri: "/helmet.gltf", version: Number.NaN },
      () => undefined,
    )).toThrow(/observeGltfAsset asset version must be a non-empty string or finite number/i);
    expect(() => root.observeGltfAsset(
      { uri: "/helmet.gltf" },
      invalidCallback,
    )).toThrow("observeGltfAsset callback must be a function");

    root.dispose();
  });

  it("observes completed frames without diagnostics polling", () => {
    const root = createRendererRoot(fakeCanvas());
    const frames: number[] = [];
    const stop = root.observeFrame((frame) => frames.push(frame));

    root.render(emptyScene());
    root.render(emptyScene());
    stop();
    root.render(emptyScene());

    expect(frames).toEqual([0, 1, 2]);
    root.dispose();
  });

  it("normalizes creation options and renders through the public root", () => {
    const canvas = fakeCanvas();
    const root = createRendererRoot(canvas, {
      alpha: false,
      automaticVirtualTextures: true,
    });
    const renderRoot = emptyScene();

    expect(root.canvas).toBe(canvas);
    expect(canvas.contextRequests).toEqual([
      {
        contextId: "webgl2",
        options: {
          alpha: false,
          antialias: true,
          preserveDrawingBuffer: false,
        },
      },
    ]);
    expect(root.snapshot()).toEqual({
      frame: 0,
      lifecycle: {
        generation: 1,
        interruptions: 0,
        recoveries: 0,
        state: "available",
      },
      options: {
        alpha: false,
        antialias: true,
        automaticVirtualTextures: true,
      },
    });
    const diagnostics: RoyalRendererDiagnosticsSnapshot = root.diagnostics();
    expect(Object.keys(diagnostics)).toEqual([
      "gltfInstancing",
      "gltfLoads",
      "messageStats",
      "messages",
      "picking",
      "planning",
      "resourcePressure",
      "resourceLifetime",
      "textureResidency",
      "virtualTexturing",
    ]);
    expect(diagnostics).toMatchObject({
      gltfInstancing: expect.any(Object),
      gltfLoads: expect.any(Object),
      resourcePressure: expect.any(Object),
      virtualTexturing: expect.any(Object),
    });
    expect(diagnostics).not.toHaveProperty("context");
    expect(diagnostics).not.toHaveProperty("disposed");
    expect(diagnostics).not.toHaveProperty("frame");
    expect(diagnostics).not.toHaveProperty("latestScene");
    expect(diagnostics).not.toHaveProperty("options");
    expect(root.pick({ clientX: 1, clientY: 1 })).toBeUndefined();
    const asset = { uri: "/not-retained.glb" };
    expect(root.gltfAssetSnapshot(asset)).toEqual({ state: "idle", variantNames: [] });
    const assetSnapshots: unknown[] = [];
    const stopObservingAsset = root.observeGltfAsset(asset, (snapshot) => assetSnapshots.push(snapshot));
    expect(assetSnapshots).toEqual([{ state: "idle", variantNames: [] }]);
    stopObservingAsset();

    root.render(renderRoot);

    expect(root.options).toEqual({
      alpha: false,
      antialias: true,
      automaticVirtualTextures: true,
    });
    expect(Object.isFrozen(root.options)).toBe(true);
    expect(Object.isFrozen(root.diagnostics())).toBe(true);
    expect(Object.isFrozen(root.snapshot())).toBe(true);
    expect(root.snapshot()).toEqual({
      frame: 1,
      lifecycle: {
        generation: 1,
        interruptions: 0,
        recoveries: 0,
        state: "available",
      },
      options: root.options,
    });

    root.dispose();
    expect(root.snapshot()).toEqual({
      frame: 1,
      lifecycle: {
        generation: 2,
        interruptions: 0,
        recoveries: 0,
        state: "disposed",
      },
      options: root.options,
    });
  });

  it("maps backend context lifecycle into push-based neutral availability", () => {
    const canvas = fakeCanvas();
    const root = createRendererRoot(canvas);
    const lifecycles: unknown[] = [];
    const stop = root.observeLifecycle((snapshot) => {
      lifecycles.push(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);
    });

    canvas.dispatchFakeEvent(
      "webglcontextlost",
      new Event("webglcontextlost", { cancelable: true }) as unknown as PointerEvent,
    );
    canvas.dispatchFakeEvent(
      "webglcontextrestored",
      new Event("webglcontextrestored") as unknown as PointerEvent,
    );

    expect(lifecycles).toEqual([
      { generation: 1, interruptions: 0, recoveries: 0, state: "available" },
      { generation: 2, interruptions: 1, recoveries: 0, state: "unavailable" },
      { generation: 2, interruptions: 1, recoveries: 0, state: "unavailable" },
      { generation: 2, interruptions: 1, recoveries: 1, state: "available" },
    ]);
    stop();
  });

  it("rejects rendering after disposal", () => {
    const root = createRendererRoot(fakeCanvas());

    root.dispose();

    expect(() => root.render(emptyScene())).toThrow("disposed Royal renderer root");
  });

  it("rejects malformed renderer options before requesting a context", () => {
    const canvas = fakeCanvas();
    expect(() => createRendererRoot(canvas, {
      alpha: "yes" as unknown as boolean,
    })).toThrow("RendererOptions alpha must be a boolean");
    expect(() => createRendererRoot(
      canvas,
      null as unknown as Parameters<typeof createRendererRoot>[1],
    )).toThrow("RendererOptions must be an object");
    expect(() => createRendererRoot(canvas, {
      antiAlias: false,
    } as unknown as Parameters<typeof createRendererRoot>[1])).toThrow(/unsupported option.*antiAlias/i);
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it("exposes coalesced invalidation for imperative changes", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const root = createRendererRoot(fakeCanvas());

    root.render(emptyScene());
    root.invalidate();
    root.invalidate();

    expect(frameCallbacks).toHaveLength(1);
    expect(root.frame).toBe(1);

    frameCallbacks[0]?.(16);

    expect(root.frame).toBe(2);
  });

  it("consumes a queued invalidation when an immediate render intervenes", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const root = createRendererRoot(fakeCanvas());

    root.render(emptyScene());
    root.invalidate();
    root.render(emptyScene());

    expect(root.frame).toBe(2);
    frameCallbacks[0]?.(16);
    expect(root.frame).toBe(2);
  });

  it("defers demand rendering while an external frame clock is active", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const root = createRendererRoot(fakeCanvas());

    root.render(emptyScene());
    root.invalidate();
    const releaseExternalClock = acquireExternalRenderClockForRoyalRoot(root).release;
    frameCallbacks[0]?.(16);

    expect(root.frame).toBe(1);
    releaseExternalClock();
    expect(frameCallbacks).toHaveLength(2);

    frameCallbacks[1]?.(32);
    expect(root.frame).toBe(2);
  });

  it("honors an explicit public force-flush while React owns the render clock", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const root = createRendererRoot(fakeCanvas());
    root.render(emptyScene());
    const rendererClock = acquireExternalRenderClockForRoyalRoot(root);

    root.invalidate();
    root.flushInvalidated();

    expect(root.frame).toBe(2);
    expect(frameCallbacks).toHaveLength(0);
    rendererClock.release();
    expect(frameCallbacks).toHaveLength(0);
    root.dispose();
  });

  it("flushes React-owned demand through the external-clock capability", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const root = createRendererRoot(fakeCanvas());
    root.render(emptyScene());
    const rendererClock = acquireExternalRenderClockForRoyalRoot(root);

    root.invalidate();
    rendererClock.flushInvalidated();

    expect(root.frame).toBe(2);
    expect(frameCallbacks).toHaveLength(0);
    rendererClock.release();
    expect(frameCallbacks).toHaveLength(0);
    root.dispose();
  });

  it("matches the demand-render model across randomized clock interleavings", () => {
    type Operation = {
      readonly index?: number;
      readonly kind: "acquire" | "fire" | "flush" | "immediate" | "invalidate" | "release";
    };

    forEachFuzzCase({
      cases: 48,
      replays: [{
        label: "stale-frame-after-clock-handoff",
        value: [
          { kind: "invalidate" },
          { kind: "acquire" },
          { index: 0, kind: "release" },
          { index: 0, kind: "fire" },
          { index: 0, kind: "fire" },
        ] satisfies readonly Operation[],
      }],
      seed: 0xd3a4_4d5,
    }, ({ label, random, replay }) => {
      const queuedFrames: { readonly callback: FrameRequestCallback; readonly id: number }[] = [];
      let nextFrameId = 1;
      vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        queuedFrames.push({ callback, id });
        return id;
      }));
      const root = createRendererRoot(fakeCanvas());
      const releases: { active: boolean; readonly release: () => void }[] = [];
      let dirty = false;
      let externalClocks = 0;
      let expectedFrame = 1;
      let scheduledFrameId: number | undefined;
      root.render(emptyScene());

      const assertFrame = (operation: string): void => {
        expect(root.frame, `${label} ${operation}`).toBe(expectedFrame);
      };
      const recordExpectedSchedule = (previousNextFrameId: number, operation: string): void => {
        expect(nextFrameId, `${label} ${operation} schedule count`).toBe(previousNextFrameId + 1);
        scheduledFrameId = previousNextFrameId;
      };
      const run = (operation: Operation, ordinal: number): void => {
        const operationLabel = `${ordinal}:${operation.kind}`;
        if (operation.kind === "invalidate") {
          dirty = true;
          const shouldSchedule = externalClocks === 0 && scheduledFrameId === undefined;
          const previousNextFrameId = nextFrameId;
          root.invalidate();
          if (shouldSchedule) recordExpectedSchedule(previousNextFrameId, operationLabel);
          else expect(nextFrameId, `${label} ${operationLabel} no schedule`).toBe(previousNextFrameId);
        } else if (operation.kind === "acquire") {
          releases.push({ active: true, release: acquireExternalRenderClockForRoyalRoot(root).release });
          externalClocks += 1;
          scheduledFrameId = undefined;
        } else if (operation.kind === "release") {
          if (releases.length === 0) return;
          const release = releases[(operation.index ?? 0) % releases.length]!;
          const wasActive = release.active;
          if (wasActive) {
            release.active = false;
            externalClocks -= 1;
          }
          const shouldSchedule = wasActive
            && externalClocks === 0
            && dirty
            && scheduledFrameId === undefined;
          const previousNextFrameId = nextFrameId;
          release.release();
          if (shouldSchedule) recordExpectedSchedule(previousNextFrameId, operationLabel);
          else expect(nextFrameId, `${label} ${operationLabel} no schedule`).toBe(previousNextFrameId);
        } else if (operation.kind === "fire") {
          if (queuedFrames.length === 0) return;
          const queueIndex = (operation.index ?? 0) % queuedFrames.length;
          const [queued] = queuedFrames.splice(queueIndex, 1);
          if (queued === undefined) return;
          if (
            queued.id === scheduledFrameId
            && dirty
            && externalClocks === 0
          ) {
            scheduledFrameId = undefined;
            dirty = false;
            expectedFrame += 1;
          }
          queued.callback(ordinal * 16);
        } else if (operation.kind === "immediate") {
          root.render(emptyScene());
          dirty = false;
          scheduledFrameId = undefined;
          expectedFrame += 1;
        } else {
          if (dirty) {
            dirty = false;
            scheduledFrameId = undefined;
            expectedFrame += 1;
          }
          root.flushInvalidated();
        }
        assertFrame(operationLabel);
      };

      const operations = replay === undefined
        ? Array.from({ length: 96 }, () => ({
          index: random.int(0, 16),
          kind: random.pick([
            "acquire",
            "fire",
            "flush",
            "immediate",
            "invalidate",
            "release",
          ] as const),
        } satisfies Operation))
        : replay as readonly Operation[];
      for (const [ordinal, operation] of operations.entries()) run(operation, ordinal);

      for (const release of releases) {
        if (!release.active) continue;
        run({ index: releases.indexOf(release), kind: "release" }, operations.length);
      }
      while (queuedFrames.length > 0) run({ kind: "fire" }, operations.length + queuedFrames.length);
      assertFrame("settled");
      root.dispose();
    });
  });
});
