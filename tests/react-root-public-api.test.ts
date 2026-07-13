import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRendererRoot,
  type RoyalRendererDiagnosticsSnapshot,
} from "@royal/react";
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "@royal/renderer-webgl";
import {
  perspectiveCamera,
  scene,
  type RenderRoot,
} from "@royal/renderer-core";
import { webGlRootForRoyalRoot } from "../packages/react/src/root";
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
  it("defensively freezes a custom resource governor policy without changing default snapshots", () => {
    const classes = Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
      ([resourceClass, value]) => [resourceClass, {
        cpuDecodedBytes: { ...value.cpuDecodedBytes },
        persistentGpuBytes: { ...value.persistentGpuBytes },
      }],
    )) as unknown as ResourceGovernorPolicy["classes"];
    const customPolicy = {
      classes: {
        ...classes,
        "virtual-texture": {
          ...classes["virtual-texture"],
          persistentGpuBytes: {
            ...classes["virtual-texture"].persistentGpuBytes,
            hardLimit: 256 * 1024 * 1024,
          },
        },
      },
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, uploadBytes: 8 * 1024 * 1024 },
    } satisfies ResourceGovernorPolicy;
    const root = createRendererRoot(fakeCanvas(), { context: { resourceGovernorPolicy: customPolicy } });
    const retained = root.context.resourceGovernorPolicy;

    expect(retained).toEqual(customPolicy);
    expect(retained).not.toBe(customPolicy);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained?.classes)).toBe(true);
    expect(Object.isFrozen(retained?.classes.geometry.cpuDecodedBytes)).toBe(true);
    expect(retained?.classes["virtual-texture"].persistentGpuBytes.hardLimit)
      .toBe(256 * 1024 * 1024);
    customPolicy.limits.uploadBytes = 1;
    expect(root.diagnostics().resourceGovernor.limits.uploadBytes).toBe(8 * 1024 * 1024);
    root.dispose();

    const defaultRoot = createRendererRoot(fakeCanvas());
    expect(defaultRoot.context).not.toHaveProperty("resourceGovernorPolicy");
    defaultRoot.dispose();
  });

  it("rejects an invalid resource governor policy before requesting a WebGL context", () => {
    const canvas = fakeCanvas();
    const classes = Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
      ([resourceClass, value]) => [resourceClass, {
        cpuDecodedBytes: { ...value.cpuDecodedBytes },
        persistentGpuBytes: { ...value.persistentGpuBytes },
      }],
    )) as unknown as ResourceGovernorPolicy["classes"];
    const invalidPolicy = {
      classes: {
        ...classes,
        geometry: {
          ...classes.geometry,
          persistentGpuBytes: {
            mandatoryFloor: DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.persistentGpuBytes,
            softLimit: DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.persistentGpuBytes,
          },
        },
      },
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits },
    } satisfies ResourceGovernorPolicy;

    expect(() => createRendererRoot(canvas, {
      context: { resourceGovernorPolicy: invalidPolicy },
    })).toThrow("persistentGpuBytes mandatory floors exceed capacity");
    expect(canvas.contextRequests).toEqual([]);
  });

  it("normalizes context options and renders through the public root", () => {
    const canvas = fakeCanvas();
    const root = createRendererRoot(canvas, {
      context: {
        alpha: false,
        generatedImageVirtualTextures: true,
      },
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
      context: {
        alpha: false,
        antialias: true,
        generatedImageVirtualTextures: true,
        generatedSvgVirtualTextureRasterDensity: 4,
      },
      disposed: false,
      frame: 0,
      lifecycle: { generation: 1, lifecycle: "available" },
    });
    const diagnostics: RoyalRendererDiagnosticsSnapshot = root.diagnostics();
    expect(diagnostics).toMatchObject({
      disposed: false,
      frame: 0,
      gltfInstancing: expect.any(Object),
      resourceGovernor: expect.any(Object),
      virtualTexturing: expect.any(Object),
    });
    expect(webGlRootForRoyalRoot(root).snapshot()).toMatchObject({
      frame: 0,
      gltfInstancing: expect.any(Object),
      virtualTexturing: expect.any(Object),
    });
    expect(webGlRootForRoyalRoot(root).options).toMatchObject({
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 4,
    });
    expect(root.pick({ clientX: 1, clientY: 1 })).toBeUndefined();

    root.render(renderRoot);

    expect(root.context).toEqual({
      alpha: false,
      antialias: true,
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 4,
    });
    expect(Object.isFrozen(root.context)).toBe(true);
    expect(Object.isFrozen(root.snapshot())).toBe(true);
    expect(root.snapshot()).toEqual({
      context: root.context,
      disposed: false,
      frame: 1,
      lifecycle: { generation: 1, lifecycle: "available" },
    });

    root.dispose();
    expect(root.snapshot()).toEqual({
      context: root.context,
      disposed: true,
      frame: 1,
      lifecycle: { generation: 2, lifecycle: "disposed" },
    });
  });

  it("keeps the neutral React snapshot on the lean WebGL path", () => {
    const root = createRendererRoot(fakeCanvas());
    const webGlRoot = webGlRootForRoyalRoot(root);
    const webGlSnapshot = vi.spyOn(webGlRoot, "snapshot");

    root.snapshot();

    expect(webGlSnapshot).not.toHaveBeenCalled();
    root.diagnostics();
    expect(webGlSnapshot).toHaveBeenCalledTimes(1);
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
      { generation: 1, lifecycle: "available" },
      { generation: 2, lifecycle: "unavailable" },
      { generation: 2, lifecycle: "unavailable" },
      { generation: 2, lifecycle: "available" },
    ]);
    stop();
  });

  it("rejects rendering after disposal", () => {
    const root = createRendererRoot(fakeCanvas());

    root.dispose();

    expect(() => root.render(emptyScene())).toThrow("disposed Royal renderer root");
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
    const webGlRoot = webGlRootForRoyalRoot(root);

    root.render(emptyScene());
    root.invalidate();
    const releaseExternalClock = webGlRoot.acquireExternalRenderClock();
    frameCallbacks[0]?.(16);

    expect(root.frame).toBe(1);
    releaseExternalClock();
    expect(frameCallbacks).toHaveLength(2);

    frameCallbacks[1]?.(32);
    expect(root.frame).toBe(2);
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
      const webGlRoot = webGlRootForRoyalRoot(root);
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
          releases.push({ active: true, release: webGlRoot.acquireExternalRenderClock() });
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
          if (dirty && externalClocks === 0) {
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
