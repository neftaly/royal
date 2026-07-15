import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  createCameraViewResource,
  createGltfInstanceTransforms,
  gltfInstances,
  mesh,
  scene,
  standardMaterial,
  studioEnvironment,
  unlitMaterial,
  virtualTexture,
  type CameraViewResource,
  type CameraViewResourceListener,
  type GltfInstanceTransforms,
} from "@royal/renderer-core";
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  type ResourceGovernorPolicy,
} from "../packages/renderer-webgl/src/resource-governor";
import { createWebGlRootWithResourcePolicy as createWebGlRoot } from "../packages/renderer-webgl/src/root";
import { preloadImageBasedLightingFeature } from "../packages/renderer-webgl/src/lazy-image-based-lighting-feature";
import { preloadClusteredLightingFeature } from "../packages/renderer-webgl/src/lazy-clustered-lighting-feature";
import { forEachFuzzCase } from "./fuzz";
import {
  camera,
  clusteredScene,
  countCalls,
  cube,
  drawCalls,
  drawableScene,
  fakeCanvas,
  fakeGl,
} from "./renderer-webgl-working-state-runtime";

await preloadImageBasedLightingFeature();
await preloadClusteredLightingFeature();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root context lifecycle contracts", () => {
  it("enforces a zero clustered-light CPU budget without observational overshoot", () => {
    const { gl } = fakeGl();
    const classPolicy = () => ({
      cpuDecodedBytes: { mandatoryFloor: 0 },
      persistentGpuBytes: { mandatoryFloor: 0 },
    });
    const resourceGovernorPolicy = {
      classes: {
        "asset-decode": classPolicy(),
        geometry: classPolicy(),
        "ordinary-texture": classPolicy(),
        "render-target": classPolicy(),
        "virtual-texture": classPolicy(),
      },
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, cpuDecodedBytes: 0 },
    } satisfies ResourceGovernorPolicy;
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy });

    expect(() => root.render(clusteredScene())).toThrow("Clustered-light CPU update denied");
    expect(root.snapshot().resourcePressure).toMatchObject({
      denialsByReason: { "cpu-decoded-capacity": 1 },
      limits: { cpuDecodedBytes: 0 },
      total: { cpuDecodedBytes: 0 },
    });
    expect(root.snapshot().resourcePressure.highWater.cpuDecodedBytes).toBe(0);
    root.dispose();
  });

  it("rejects a zero-job resource policy before requesting a WebGL context", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const resourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, jobs: 0 },
    };

    expect(() => createWebGlRoot(canvas, { resourceGovernorPolicy }))
      .toThrow("jobs capacity must be at least 1");
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it("terminally degrades oversized studio IBL under a tiny custom upload policy", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const resourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      limits: { ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits, uploadBytes: 50_000 },
    };
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { resourceGovernorPolicy });
    const graph = scene({
      camera: camera(),
      environment: studioEnvironment(),
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: standardMaterial({ color: [1, 1, 1, 1] }),
      })],
    });

    root.render(graph);

    expect(root.snapshot().diagnosticLog.entries).toContainEqual(expect.objectContaining({
      message: expect.stringMatching(
        /Studio IBL specular texture is disabled.*upload bytes exceed the per-frame limit/,
      ),
    }));
    // The HDR surface remains required for physical rendering; only the
    // over-budget studio IBL textures are suppressed.
    expect(countCalls(calls, "createTexture")).toBe(1);
    expect(scheduled).toHaveLength(1);
    expect(warning).toHaveBeenCalledTimes(1);
    const messagesBeforeRestore = root.snapshot().diagnosticLog.entries;
    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    expect(root.snapshot().diagnosticLog.entries).toEqual(messagesBeforeRestore);
    expect(warning).toHaveBeenCalledTimes(1);
    root.dispose();
  });
  it("invalidates every root sharing a committed camera resource and catches up after context restore", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const first = fakeGl();
    const second = fakeGl();
    const firstCanvas = fakeCanvas(first.gl);
    const secondCanvas = fakeCanvas(second.gl);
    const firstRoot = createWebGlRoot(firstCanvas);
    const secondRoot = createWebGlRoot(secondCanvas);
    const cameraResource = createCameraViewResource(camera());
    const renderScene = scene({ camera: cameraResource, nodes: [cube([1, 1, 1, 1])] });
    firstRoot.render(renderScene);
    secondRoot.render(renderScene);
    expect(firstRoot.snapshot().planning).toEqual({
      compileNodeVisits: 1,
      planCompiles: 1,
      planRevision: 1,
      sceneCommits: 1,
    });

    cameraResource.position[0] = 1;
    cameraResource.commit();
    expect(scheduled).toHaveLength(2);
    for (const callback of scheduled.splice(0)) callback(16);
    expect(firstRoot.frame).toBe(2);
    expect(secondRoot.frame).toBe(2);

    firstCanvas.dispatchContextEvent("webglcontextlost");
    cameraResource.position[0] = 2;
    cameraResource.commit();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(32);
    expect(firstRoot.frame).toBe(2);
    expect(secondRoot.frame).toBe(3);

    firstCanvas.dispatchContextEvent("webglcontextrestored");
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.(48);
    expect(firstRoot.frame).toBe(3);
    expect(secondRoot.frame).toBe(3);
    expect(firstRoot.snapshot().planning.planCompiles).toBe(1);
    expect(secondRoot.snapshot().planning.planCompiles).toBe(1);
    firstRoot.dispose();
    secondRoot.dispose();
    cameraResource.position[0] = 3;
    cameraResource.commit();
    expect(scheduled).toHaveLength(0);
  });

  it("invalidates GPU handles without GL calls and lazily redraws after context restoration", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const observerErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    root.observeContextLifecycle((snapshot) => {
      if (snapshot.lifecycle === "lost") throw new Error("observer failure");
    });
    let stopSelfObserver = (): void => undefined;
    stopSelfObserver = root.observeContextLifecycle((snapshot) => {
      if (snapshot.lifecycle === "lost") stopSelfObserver();
    });
    const contextTransitions: unknown[] = [];
    const stopObservingContext = root.observeContextLifecycle((snapshot) => {
      contextTransitions.push(snapshot);
      expect(Object.isFrozen(snapshot)).toBe(true);
    });
    const firstScene = drawableScene([0, 0, 0, 0]);
    const retainedScene = scene({
      camera: camera(),
      clearColor: [0.1, 0.2, 0.3, 1],
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ texture: virtualTexture("/lost-context.vt.json") }),
      })],
    });

    root.render(firstScene);
    expect(root.snapshot().planning.planRevision).toBe(1);
    const programsBeforeLoss = countCalls(calls, "createProgram");
    const callsBeforeLoss = calls.length;
    const loss = canvas.dispatchContextEvent("webglcontextlost");
    const callsAtLoss = calls.length;

    expect(loss.defaultPrevented).toBe(true);
    expect(callsAtLoss).toBe(callsBeforeLoss);
    expect(root.snapshot().context).toMatchObject({ generation: 2, lifecycle: "lost", losses: 1 });
    root.render(retainedScene);
    expect(root.snapshot().planning).toEqual({
      compileNodeVisits: 2,
      planCompiles: 2,
      planRevision: 2,
      sceneCommits: 2,
    });
    root.invalidate();
    expect(root.pick({ clientX: 1, clientY: 1 })).toBeUndefined();
    expect(calls).toHaveLength(callsAtLoss);
    expect(root.snapshot().resourceLifetime.sceneLeaseAcquires).toBe(2);

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(root.snapshot().context).toMatchObject({ generation: 2, lifecycle: "active", restores: 1 });
    expect(root.latestScene).toBe(retainedScene);
    expect(root.snapshot().planning.planCompiles).toBe(2);
    const restoreFrame = scheduled.at(-1);
    expect(restoreFrame).toBeDefined();
    restoreFrame?.(16);

    expect(countCalls(calls, "createProgram")).toBeGreaterThan(programsBeforeLoss);
    expect(drawCalls(calls)).toHaveLength(2);
    expect(contextTransitions).toEqual([
      expect.objectContaining({ generation: 1, lifecycle: "active" }),
      expect.objectContaining({ generation: 2, lifecycle: "lost" }),
      expect.objectContaining({ generation: 2, lifecycle: "restoring" }),
      expect.objectContaining({ generation: 2, lifecycle: "active", restores: 1 }),
    ]);
    expect(observerErrors).toHaveBeenCalledTimes(1);
    stopObservingContext();
  });

  it("publishes a terminal restore failure without reacquiring a different context", () => {
    const first = fakeGl();
    const replacement = fakeGl();
    const canvas = fakeCanvas(first.gl);
    const root = createWebGlRoot(canvas);
    const transitions: unknown[] = [];
    root.observeContextLifecycle((snapshot) => transitions.push(snapshot));
    canvas.getContext.mockImplementationOnce(() => replacement.gl);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");

    expect(root.contextSnapshot()).toMatchObject({
      generation: 2,
      lastError: expect.stringMatching(/renderer-owned WebGL2 context/i),
      lifecycle: "lost",
    });
    expect(transitions).toEqual([
      expect.objectContaining({ lifecycle: "active" }),
      expect.objectContaining({ lifecycle: "lost" }),
      expect.objectContaining({ lifecycle: "restoring" }),
      expect.objectContaining({ lastError: expect.any(String), lifecycle: "lost" }),
    ]);
  });

  it("publishes context loss exactly once and preserves opaque cleanup failure", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const transitions: string[] = [];
    root.observeContextLifecycle((snapshot) => transitions.push(snapshot.lifecycle));
    const originalClear = Set.prototype.clear;
    let injectFailure = true;
    let clearCalls = 0;
    vi.spyOn(Set.prototype, "clear").mockImplementation(function (this: Set<unknown>) {
      clearCalls += 1;
      originalClear.call(this);
      if (injectFailure) {
        injectFailure = false;
        throw undefined;
      }
    });

    const firstLoss = canvas.invokeContextEvent("webglcontextlost");

    expect(firstLoss.event.defaultPrevented).toBe(true);
    expect(firstLoss.failurePresent).toBe(true);
    expect(firstLoss.failure).toBeUndefined();
    expect(root.contextLifecycle).toBe("lost");
    expect(transitions).toEqual(["active", "lost"]);
    expect(clearCalls).toBeGreaterThan(1);

    const duplicateLoss = canvas.invokeContextEvent("webglcontextlost");
    expect(duplicateLoss.failurePresent).toBe(false);
    expect(transitions).toEqual(["active", "lost"]);
  });

  it("reports actual default context attributes and rejects explicit mismatches", () => {
    const defaults = fakeGl();
    (defaults.gl as WebGL2RenderingContext & {
      getContextAttributes: () => WebGLContextAttributes;
    }).getContextAttributes = vi.fn(() => ({ alpha: false, antialias: false }));
    const root = createWebGlRoot(fakeCanvas(defaults.gl));
    expect(root.options).toMatchObject({ alpha: false, antialias: false });

    const explicit = fakeGl();
    (explicit.gl as WebGL2RenderingContext & {
      getContextAttributes: () => WebGLContextAttributes;
    }).getContextAttributes = vi.fn(() => ({ alpha: true, antialias: false }));
    expect(() => createWebGlRoot(fakeCanvas(explicit.gl), { antialias: true }))
      .toThrow(/requested antialias=true.*received antialias=false/i);
  });

  it("rejects unavailable context attributes during construction", () => {
    const { gl } = fakeGl();
    vi.mocked(gl.getContextAttributes).mockReturnValue(null);

    expect(() => createWebGlRoot(fakeCanvas(gl)))
      .toThrow("Royal WebGL context attributes are unavailable");
  });

  it("publishes unavailable restored context attributes as a restore failure", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    vi.mocked(gl.getContextAttributes).mockReturnValue(null);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");

    expect(root.contextSnapshot()).toMatchObject({
      lastError: "Royal WebGL context attributes are unavailable",
      lifecycle: "lost",
      restores: 0,
    });
    root.dispose();
  });

  it("uses extension support structurally when deciding whether physical lighting can render", () => {
    const supported = fakeGl();
    const supportedRoot = createWebGlRoot(fakeCanvas(supported.gl));
    expect(() => supportedRoot.render(clusteredScene())).not.toThrow();
    supportedRoot.dispose();

    const unsupported = fakeGl();
    vi.mocked(unsupported.gl.getExtension).mockReturnValue(null);
    const unsupportedRoot = createWebGlRoot(fakeCanvas(unsupported.gl));
    expect(() => unsupportedRoot.render(clusteredScene()))
      .toThrow("Royal physical lighting requires EXT_color_buffer_float");
    unsupportedRoot.dispose();
  });

  it("keeps context lifecycle safe under generated loss, restore, demand, and stale-frame sequences", () => {
    forEachFuzzCase({ cases: 48, seed: 0x63b77a21 }, ({ random }) => {
      const scheduled: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
        scheduled.push(callback);
        return scheduled.length;
      }));
      const { calls, gl } = fakeGl();
      const canvas = fakeCanvas(gl);
      const root = createWebGlRoot(canvas);
      const renderScene = drawableScene([0, 0, 0, 0]);
      root.render(renderScene);
      let lifecycle: "active" | "lost" = "active";

      for (let step = 0; step < 64; step += 1) {
        const action = random.int(0, 6);
        if (action === 0 && lifecycle === "active") {
          const event = canvas.dispatchContextEvent("webglcontextlost");
          expect(event.defaultPrevented).toBe(true);
          lifecycle = "lost";
        } else if (action === 1 && lifecycle === "lost") {
          canvas.dispatchContextEvent("webglcontextrestored");
          lifecycle = "active";
        } else if (action === 2) {
          const before = calls.length;
          root.render(renderScene);
          if (lifecycle === "lost") expect(calls).toHaveLength(before);
        } else if (action === 3) {
          root.invalidate();
        } else if (action === 4 && scheduled.length > 0) {
          const before = calls.length;
          scheduled.shift()?.(step * 16);
          if (lifecycle === "lost") expect(calls).toHaveLength(before);
        } else if (action === 5) {
          const before = calls.length;
          root.pick({ clientX: 2, clientY: 2 });
          if (lifecycle === "lost") expect(calls).toHaveLength(before);
        }
        expect(root.contextLifecycle).toBe(lifecycle);
      }

      const callsBeforeDispose = calls.length;
      root.dispose();
      if (lifecycle === "lost") expect(calls).toHaveLength(callsBeforeDispose);
      canvas.dispatchContextEvent("webglcontextrestored");
      for (const callback of scheduled) callback(2_000);
      expect(root.snapshot().context.lifecycle).toBe("disposed");
    });
  });

  it("rejects canvases that cannot provide a WebGL2 context with a clear error", () => {
    const canvas = fakeCanvas(null);

    expect(() => createWebGlRoot(canvas)).toThrow(/WebGL2 context/i);
    expect(canvas.getContext.mock.calls.some((call) => call[0] === "webgl2")).toBe(true);
  });

  it("preserves a primary render failure while completing the logical epilogue and every GL normalization", () => {
    const { gl } = fakeGl();
    const primaryFailure = new Error("primary render failure");
    vi.mocked(gl.clear).mockImplementation(() => {
      throw primaryFailure;
    });
    vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
      if (vertexArray === null) throw undefined;
    });
    vi.mocked(gl.bindBuffer).mockImplementation((_target, buffer) => {
      if (buffer === null) throw new Error("secondary normalization failure");
    });
    const root = createWebGlRoot(fakeCanvas(gl));

    let thrownPresent = false;
    let thrown: unknown;
    try {
      root.render(drawableScene([0, 0, 0, 0]));
    } catch (value) {
      thrownPresent = true;
      thrown = value;
    }

    expect(thrownPresent).toBe(true);
    expect(thrown).toBe(primaryFailure);
    expect(root.frame).toBe(1);
    expect(gl.bindVertexArray).toHaveBeenCalledWith(null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ARRAY_BUFFER, null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ELEMENT_ARRAY_BUFFER, null);
  });

  it("preserves an opaque undefined GL normalization failure", () => {
    const { gl } = fakeGl();
    vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
      if (vertexArray === null) throw undefined;
    });
    const root = createWebGlRoot(fakeCanvas(gl));
    let thrownPresent = false;
    let thrown: unknown = "not thrown";

    try {
      root.render(drawableScene([0, 0, 0, 0]));
    } catch (value) {
      thrownPresent = true;
      thrown = value;
    }

    expect(thrownPresent).toBe(true);
    expect(thrown).toBeUndefined();
  });

  it("attempts later epilogue and normalization phases after body and early-epilogue failures", () => {
    const { gl } = fakeGl();
    const primaryFailure = new Error("baseline preparation failed");
    vi.mocked(gl.clearDepth).mockImplementation(() => {
      throw primaryFailure;
    });
    let nullFramebufferBindings = 0;
    vi.mocked(gl.bindFramebuffer).mockImplementation((_target, framebuffer) => {
      if (framebuffer === null && ++nullFramebufferBindings > 1) {
        throw new Error("framebuffer normalization failed");
      }
    });
    vi.mocked(gl.bindVertexArray).mockImplementation((vertexArray) => {
      if (vertexArray === null) throw undefined;
    });
    vi.mocked(gl.bindBuffer).mockImplementation((_target, buffer) => {
      if (buffer === null) throw new Error("buffer normalization failed");
    });
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => root.render(drawableScene([0, 0, 0, 0]))).toThrow(primaryFailure);
    // Baseline preparation failed before the instance-buffer frame began, so
    // unused-batch release also fails. The later frame/budget advance and all
    // GL normalization operations must nevertheless still run.
    expect(root.frame).toBe(1);
    expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
    expect(gl.bindVertexArray).toHaveBeenLastCalledWith(null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ARRAY_BUFFER, null);
    expect(gl.bindBuffer).toHaveBeenCalledWith(gl.ELEMENT_ARRAY_BUFFER, null);
  });

  it("preserves an opaque dispose failure while attempting later GPU authorities", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(drawableScene([0, 0, 0, 0]));
    vi.mocked(gl.deleteBuffer).mockImplementation(() => {
      throw undefined;
    });
    vi.mocked(gl.deleteProgram).mockImplementation(() => {
      throw new Error("later program cleanup failed");
    });
    let failurePresent = false;
    let failure: unknown = "not thrown";

    try {
      root.dispose();
    } catch (value) {
      failurePresent = true;
      failure = value;
    }

    expect(failurePresent).toBe(true);
    expect(failure).toBeUndefined();
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(root.disposed).toBe(true);
    expect(root.contextLifecycle).toBe("disposed");
  });

  it("retries an opaque program deletion failure on repeated root disposal", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(drawableScene([0, 0, 0, 0]));
    let attempts = 0;
    vi.mocked(gl.deleteProgram).mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) throw undefined;
    });

    let firstFailurePresent = false;
    try {
      root.dispose();
    } catch (error) {
      firstFailurePresent = true;
      expect(error).toBeUndefined();
    }
    expect(firstFailurePresent).toBe(true);
    expect(attempts).toBe(1);

    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(2);
  });

  it("retries glTF instance-transform unsubscription on repeated root disposal", () => {
    const { gl } = fakeGl();
    const base = createGltfInstanceTransforms({ count: 1 });
    const unsubscribeFailure = new Error("instance unsubscribe failed");
    let activeSubscriptions = 0;
    let unsubscribeAttempts = 0;
    const instances: GltfInstanceTransforms = {
      commitPose: base.commitPose,
      commitScale: base.commitScale,
      count: base.count,
      get poseVersion() {
        return base.poseVersion;
      },
      positions: base.positions,
      rotations: base.rotations,
      get scaleVersion() {
        return base.scaleVersion;
      },
      scales: base.scales,
      subscribe(listener) {
        activeSubscriptions += 1;
        const unsubscribe = base.subscribe(listener);
        return () => {
          unsubscribeAttempts += 1;
          if (unsubscribeAttempts === 1) throw unsubscribeFailure;
          activeSubscriptions -= 1;
          unsubscribe();
        };
      },
    };
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(scene({
      camera: camera(),
      clearColor: [0, 0, 0, 0],
      nodes: [gltfInstances({
        instances,
        src: "data:application/json,%7B%22asset%22%3A%7B%22version%22%3A%222.0%22%7D%7D",
      })],
    }));
    expect(activeSubscriptions).toBe(1);

    expect(() => root.dispose()).toThrow(unsubscribeFailure);
    expect(activeSubscriptions).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(activeSubscriptions).toBe(0);
    expect(unsubscribeAttempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(unsubscribeAttempts).toBe(2);
  });

  it("retries camera-view unsubscription on repeated root disposal", () => {
    const { gl } = fakeGl();
    const base = createCameraViewResource(camera());
    const unsubscribeFailure = new Error("camera unsubscribe failed");
    let activeSubscriptions = 0;
    let unsubscribeAttempts = 0;
    const cameraResource = new Proxy(base, {
      get(target, property) {
        if (property !== "subscribe") return Reflect.get(target, property, target);
        return (listener: CameraViewResourceListener): (() => void) => {
          const unsubscribe = target.subscribe(listener);
          activeSubscriptions += 1;
          let active = true;
          return () => {
            unsubscribeAttempts += 1;
            if (unsubscribeAttempts === 1) throw unsubscribeFailure;
            if (!active) return;
            active = false;
            activeSubscriptions -= 1;
            unsubscribe();
          };
        };
      },
    }) satisfies CameraViewResource;
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(scene({ camera: cameraResource, nodes: [] }));
    expect(activeSubscriptions).toBe(1);

    expect(() => root.dispose()).toThrow(unsubscribeFailure);
    expect(activeSubscriptions).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(activeSubscriptions).toBe(0);
    expect(unsubscribeAttempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(unsubscribeAttempts).toBe(2);
  });

  it("retains an HDR target lease across an opaque delete failure and releases it on retry", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(clusteredScene());
    expect(gl.createTexture).toHaveBeenCalledTimes(4);
    let attempts = 0;
    vi.mocked(gl.deleteTexture).mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) throw undefined;
    });

    let firstFailurePresent = false;
    try {
      root.dispose();
    } catch (error) {
      firstFailurePresent = true;
      expect(error).toBeUndefined();
    }

    expect(firstFailurePresent).toBe(true);
    expect(attempts).toBe(4);
    // The failed HDR texture retains its target lease until deletion retries;
    // the clustered-light resources completed their independent cleanup.
    expect(root.snapshot().resourcePressure.outstandingLeases).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(5);
    expect(root.snapshot().resourcePressure.outstandingLeases).toBe(0);
    expect(() => root.dispose()).not.toThrow();
    expect(attempts).toBe(5);
  });

  it("drops clustered-light handles and accounting without GL calls on genuine context loss", () => {
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    root.render(clusteredScene());
    expect(root.snapshot().resourcePressure.outstandingLeases).toBeGreaterThan(0);
    const callsBeforeLoss = calls.length;

    canvas.dispatchContextEvent("webglcontextlost");

    expect(calls).toHaveLength(callsBeforeLoss);
    expect(root.snapshot().resourcePressure.outstandingLeases).toBe(0);
    expect(() => root.dispose()).not.toThrow();
  });

  it("preserves listener-removal precedence while completing later disposal phases", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    root.render(drawableScene([0, 0, 0, 0]));
    const primaryFailure = new Error("listener removal failed");
    let removalCount = 0;
    vi.spyOn(canvas, "removeEventListener").mockImplementation(() => {
      removalCount += 1;
      if (removalCount === 1) throw primaryFailure;
    });
    vi.mocked(gl.deleteProgram).mockImplementation(() => {
      throw new Error("later program cleanup failed");
    });

    expect(() => root.dispose()).toThrow(primaryFailure);
    expect(removalCount).toBe(2);
    expect(gl.deleteProgram).toHaveBeenCalled();
    expect(root.disposed).toBe(true);
  });

});
