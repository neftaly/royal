import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  mesh,
  scene,
  unlitMaterial,
  type RenderObjectHandle,
  type RenderRoot,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import type { WebGlRenderViewsOptions } from "@royal/renderer-webgl";
import {
  camera,
  countCalls,
  drawCalls,
  drawableScene,
  fakeCanvas,
  fakeGl,
} from "./renderer-webgl-working-state-runtime";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root render state contracts", () => {
  it("rejects malformed explicit views before committing scene state", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const retained = drawableScene([0, 0, 0, 0]);
    const replacement = drawableScene([1, 0, 0, 1]);
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const validView = {
      projectionMatrix: identity,
      viewMatrix: identity,
      viewport: { height: 64, width: 64, x: 0, y: 0 },
    };
    root.render(retained);
    const before = root.snapshot();
    const malformed: readonly unknown[] = [
      null,
      {},
      { extra: true, views: [validView] },
      { views: [] },
      { views: [{ ...validView, projectionMatrix: identity.slice(1) }] },
      { views: [{ ...validView, viewMatrix: [...identity.slice(0, 15), Number.NaN] }] },
      { views: [{ ...validView, viewport: { ...validView.viewport, width: 0 } }] },
      { framebuffer: [], views: [validView] },
    ];

    for (const options of malformed) {
      expect(() => root.renderViews(replacement, options as WebGlRenderViewsOptions)).toThrow();
    }
    expect(root.latestScene).toBe(retained);
    expect(root.snapshot()).toMatchObject({
      frame: before.frame,
      planning: before.planning,
    });
  });

  it("updates the canvas backing store and viewport from CSS size and DPR each frame", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl, { width: 320, height: 180 });
    const root = createWebGlRoot(canvas);
    const renderScene = drawableScene([0, 0, 0, 0]);

    root.render(renderScene);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(calls).toContainEqual({ name: "viewport", args: [0, 0, 640, 360] });

    vi.stubGlobal("devicePixelRatio", 1.5);
    canvas.setCssSize({ width: 240, height: 120 });
    root.render(renderScene);

    expect(canvas.width).toBe(360);
    expect(canvas.height).toBe(180);
    expect(calls).toContainEqual({ name: "viewport", args: [0, 0, 360, 180] });
  });

  it("uses fixed attributes and caches uniform locations across repeated draws", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = drawableScene([0, 0, 0, 0]);

    root.render(renderScene);
    const firstAttribLookups = countCalls(calls, "getAttribLocation");
    const firstUniformLookups = countCalls(calls, "getUniformLocation");

    expect(firstAttribLookups).toBe(0);
    expect(firstUniformLookups).toBeGreaterThan(0);

    root.render(renderScene);

    expect(countCalls(calls, "getAttribLocation")).toBe(firstAttribLookups);
    expect(countCalls(calls, "getUniformLocation")).toBe(firstUniformLookups);
    expect(drawCalls(calls)).toHaveLength(2);
  });

  it("keeps regular mesh draws non-blended by default", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 0, 0, 0.35] }),
            }),
      ],
    }));

    const drawIndex = calls.findIndex((call) => call.name === "drawArrays" || call.name === "drawElements");
    const lastBlendStateBeforeDraw = calls
      .slice(0, drawIndex)
      .filter((call) => (call.name === "enable" || call.name === "disable") && call.args[0] === gl.BLEND)
      .at(-1);

    expect(drawIndex).toBeGreaterThan(-1);
    expect(lastBlendStateBeforeDraw).toEqual({ name: "disable", args: [gl.BLEND] });
    expect(calls).not.toContainEqual({ name: "enable", args: [gl.BLEND] });
    expect(calls).not.toContainEqual({ name: "depthMask", args: [false] });
  });

  it("accepts a scene with no nodes without issuing draw calls", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => {
      root.render(scene({
        camera: camera(),
        nodes: [],
      }));
    }).not.toThrow();

    expect(drawCalls(calls)).toHaveLength(0);
    const snapshot = root.snapshot();
    expect(snapshot).not.toHaveProperty("latestScene");
    expect(snapshot).toMatchObject({
      disposed: false,
      frame: 1,
      resourcePressure: {
        frame: 1,
        limits: {
          cpuDecodedBytes: 512 * 1024 * 1024,
          jobs: 8,
          persistentGpuBytes: 512 * 1024 * 1024,
          transientPeakBytes: 192 * 1024 * 1024,
          uploadBytes: 16 * 1024 * 1024,
        },
      },
    });
  });

  it("redraws after imperative render object ref transform updates", async () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
              },
            }),
      ],
    });

    root.render(renderScene);
    const handle = ref.current;
    if (handle === null) throw new Error("Expected mesh ref to be attached");
    const initialDraws = drawCalls(calls).length;

    handle.rotation.y = Math.PI / 2;
    await Promise.resolve();

    expect(handle.rotation.y).toBe(Math.PI / 2);
    expect(root.frame).toBe(2);
    expect(drawCalls(calls)).toHaveLength(initialDraws + 1);

    root.render(scene({
      camera: camera(),
      nodes: [],
    }));

    expect(ref.current).toBeNull();
  });

  it("keeps a shared render object ref attached to and invalidating every live root", async () => {
    const first = fakeGl();
    const second = fakeGl();
    const firstRoot = createWebGlRoot(fakeCanvas(first.gl));
    const secondRoot = createWebGlRoot(fakeCanvas(second.gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const sharedScene = scene({
      camera: camera(),
      nodes: [mesh({
        geometry: boxGeometry(1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        ref,
      })],
    });

    firstRoot.render(sharedScene);
    const sharedHandle = ref.current;
    if (sharedHandle === null) throw new Error("Expected shared ref to be attached");
    secondRoot.render(sharedScene);
    expect(ref.current).toBe(sharedHandle);

    sharedHandle.position.x = 3;
    await Promise.resolve();
    expect(firstRoot.frame).toBe(2);
    expect(secondRoot.frame).toBe(2);

    firstRoot.dispose();
    expect(ref.current).toBe(sharedHandle);
    sharedHandle.position.y = 4;
    await Promise.resolve();
    expect(secondRoot.frame).toBe(3);

    secondRoot.dispose();
    expect(ref.current).toBeNull();
  });

  it("does not invalidate again while syncing declarative ref transforms", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = (x: number) => scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
              transform: {
                position: [x, 0, 0],
                rotation: [0, 0, 0],
              },
            }),
      ],
    });

    root.render(renderScene(0));
    const movedScene = renderScene(1);
    root.render(movedScene);

    expect(frameCallbacks).toHaveLength(0);
    expect(ref.current?.position.x).toBe(1);
    expect(root.snapshot().planning).toEqual({
      compileNodeVisits: 2,
      planCompiles: 2,
      planRevision: 2,
      sceneCommits: 2,
    });

    root.render(movedScene);
    expect(root.snapshot().planning.planCompiles).toBe(2);

    ref.current?.position.set([2, 0, 0]);

    expect(frameCallbacks).toHaveLength(1);
  });

  it("finishes a retained-plan reconciliation after one ref callback throws", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let failFirstAttachment = true;
    let firstHandle: RenderObjectHandle | null = null;
    let secondHandle: RenderObjectHandle | null = null;
    const firstRef = (handle: RenderObjectHandle | null): void => {
      if (handle !== null && failFirstAttachment) {
        failFirstAttachment = false;
        throw new Error("first ref attachment failed");
      }
      firstHandle = handle;
    };
    const committedScene = scene({
      camera: camera(),
      nodes: [
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 0, 0, 1] }), ref: firstRef }),
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [0, 1, 0, 1] }), ref: (handle) => {
          secondHandle = handle;
        } }),
      ],
    });

    expect(() => root.render(committedScene)).toThrow("first ref attachment failed");
    expect(secondHandle).not.toBeNull();
    expect(root.snapshot().planning.planCompiles).toBe(1);

    expect(() => root.render(committedScene)).not.toThrow();
    expect(firstHandle).not.toBeNull();
    expect(root.snapshot().planning).toEqual({
      compileNodeVisits: 2,
      planCompiles: 1,
      planRevision: 1,
      sceneCommits: 1,
    });
  });

  it("retries a failed final callback-ref detach without stale invalidation or attachment state", async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let handle: RenderObjectHandle | null = null;
    let clearAttempts = 0;
    let successfulClears = 0;
    const ref = (next: RenderObjectHandle | null): void => {
      if (next === null) {
        clearAttempts += 1;
        if (clearAttempts === 1) throw new Error("ref clear failed");
        successfulClears += 1;
      }
      handle = next;
    };
    const populated = scene({
      camera: camera(),
      nodes: [mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 1, 1, 1] }), ref })],
    });
    const empty = scene({ camera: camera(), nodes: [] });

    root.render(populated);
    const attachedHandle = handle as RenderObjectHandle | null;
    if (attachedHandle === null) throw new Error("Expected callback ref to be attached");
    expect(() => root.render(empty)).toThrow("ref clear failed");
    attachedHandle.position.set([2, 0, 0]);
    await Promise.resolve();
    expect(frameCallbacks).toHaveLength(0);

    expect(() => root.render(empty)).not.toThrow();
    expect(clearAttempts).toBe(2);
    expect(successfulClears).toBe(1);
    expect(handle).toBeNull();
    expect(() => root.render(populated)).not.toThrow();
    expect(handle).not.toBe(attachedHandle);
  });

  it("best-effort disposal clears later refs and retains a failed detach for retry", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let firstClearAttempts = 0;
    let secondCleared = false;
    const firstRef = (handle: RenderObjectHandle | null): void => {
      if (handle === null && ++firstClearAttempts === 1) throw new Error("dispose clear failed");
    };
    const secondRef = (handle: RenderObjectHandle | null): void => {
      if (handle === null) secondCleared = true;
    };
    root.render(scene({
      camera: camera(),
      nodes: [
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 0, 0, 1] }), ref: firstRef }),
        mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [0, 1, 0, 1] }), ref: secondRef }),
      ],
    }));

    expect(() => root.dispose()).toThrow("dispose clear failed");
    expect(secondCleared).toBe(true);
    expect(firstClearAttempts).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(firstClearAttempts).toBe(2);
    expect(() => root.dispose()).not.toThrow();
    expect(firstClearAttempts).toBe(2);
  });

  it("retries failed resource release effects without applying the scene delta twice", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const populated = drawableScene([0, 0, 0, 0]);
    const empty = scene({ camera: camera(), clearColor: [0, 0, 0, 0], nodes: [] });
    root.render(populated);
    const releaseFailure = new Error("buffer release failed");
    let failRelease = true;
    vi.mocked(gl.deleteBuffer).mockImplementation(() => {
      if (failRelease) {
        failRelease = false;
        throw releaseFailure;
      }
    });

    expect(() => root.render(empty)).toThrow(releaseFailure);
    expect(root.latestScene, "the arena and frame plan must publish one authoritative generation").toBe(empty);
    expect(root.snapshot().planning).toMatchObject({ planCompiles: 2, planRevision: 2, sceneCommits: 2 });

    const drawsBeforeRetry = drawCalls(calls).length;
    expect(() => root.render(empty)).not.toThrow();
    expect(drawCalls(calls)).toHaveLength(drawsBeforeRetry);
    expect(root.snapshot().planning, "the retry must drain effect debt without recompiling or reapplying the delta")
      .toMatchObject({ planCompiles: 2, planRevision: 2, sceneCommits: 2 });

    expect(() => root.render(populated)).not.toThrow();
    expect(drawCalls(calls)).toHaveLength(drawsBeforeRetry + 1);
    expect(root.snapshot().planning).toMatchObject({ planCompiles: 3, planRevision: 3, sceneCommits: 3 });
  });

  it("preserves opaque ref failures while completing later reconciliation work", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let secondHandle: RenderObjectHandle | null = null;
    const committedScene = scene({
      camera: camera(),
      nodes: [
        mesh({
          geometry: boxGeometry(1),
          material: unlitMaterial({ color: [1, 0, 0, 1] }),
          ref: (handle) => {
            if (handle !== null) throw undefined;
          },
        }),
        mesh({
          geometry: boxGeometry(1),
          material: unlitMaterial({ color: [0, 1, 0, 1] }),
          ref: (handle) => {
            secondHandle = handle;
          },
        }),
      ],
    });
    let failurePresent = false;
    let failure: unknown = "not thrown";

    try {
      root.render(committedScene);
    } catch (value) {
      failurePresent = true;
      failure = value;
    }

    expect(failurePresent).toBe(true);
    expect(failure).toBeUndefined();
    expect(secondHandle).not.toBeNull();
  });

  it("rejects reentrant rendering from a ref callback and retries attachment", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let attachmentAttempts = 0;
    let attachedHandle: RenderObjectHandle | null = null;
    let committedScene!: RenderRoot;
    const ref = (handle: RenderObjectHandle | null): void => {
      attachmentAttempts += 1;
      if (handle !== null && attachmentAttempts === 1) root.render(committedScene);
      attachedHandle = handle;
    };
    committedScene = scene({
      camera: camera(),
      nodes: [mesh({ geometry: boxGeometry(1), material: unlitMaterial({ color: [1, 1, 1, 1] }), ref })],
    });

    expect(() => root.render(committedScene)).toThrow(
      "Cannot render while Royal is reconciling render-object refs",
    );
    expect(root.snapshot().planning.planCompiles).toBe(1);
    expect(() => root.render(committedScene)).not.toThrow();
    expect(attachedHandle).not.toBeNull();
    expect(attachmentAttempts).toBe(2);
    expect(root.snapshot().planning.planCompiles).toBe(1);
  });

  it("coalesces imperative render object mutations before the scheduled render", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = scene({
      camera: camera(),
      nodes: [
            mesh({
              geometry: boxGeometry(1),
              material: unlitMaterial({ color: [1, 1, 1, 1] }),
              ref,
            }),
      ],
    });

    root.render(renderScene);
    const handle = ref.current;
    if (handle === null) throw new Error("Expected mesh ref to be attached");
    const initialDraws = drawCalls(calls).length;

    handle.position.set([1, 0, 0]);
    handle.rotation.set([0, 1, 0]);
    handle.scale.set([2, 2, 2]);

    expect(frameCallbacks).toHaveLength(1);
    expect(drawCalls(calls)).toHaveLength(initialDraws);

    frameCallbacks[0]?.(16);
    expect(drawCalls(calls)).toHaveLength(initialDraws + 1);

    handle.position.set([2, 0, 0]);
    expect(frameCallbacks).toHaveLength(2);
  });

  it("coalesces explicit invalidations to one animation frame", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = drawableScene([0, 0, 0, 0]);

    root.render(renderScene);
    const initialDraws = drawCalls(calls).length;

    root.invalidate();
    root.invalidate();

    expect(frameCallbacks).toHaveLength(1);
    expect(root.frame).toBe(1);
    expect(drawCalls(calls)).toHaveLength(initialDraws);

    frameCallbacks[0]?.(16);

    expect(root.frame).toBe(2);
    expect(drawCalls(calls)).toHaveLength(initialDraws + 1);
  });

  it("makes dispose idempotent while keeping render-after-dispose rejected", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderScene = scene({ camera: camera(), nodes: [] });

    root.dispose();

    expect(() => root.dispose()).not.toThrow();
    expect(root.disposed).toBe(true);
    expect(() => root.render(renderScene)).toThrow(/disposed Royal renderer root/i);
  });

  it("reports renderer-owned scheduled failures without an uncaught async throw", () => {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduled.push(callback);
      return scheduled.length;
    }));
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    root.render(scene({ camera: camera(), nodes: [] }));
    const failure = new Error("scheduled draw failed");
    const observed: unknown[] = [];
    const observerErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stopThrowing = root.observeRenderFailures(() => {
      throw new Error("observer failed");
    });
    const stop = root.observeRenderFailures((value) => observed.push(value));
    vi.mocked(gl.clear).mockImplementationOnce(() => { throw failure; });

    root.invalidate();
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled.shift()?.(16)).not.toThrow();
    expect(observed).toEqual([failure]);
    expect(observerErrors).toHaveBeenCalledWith(
      "Royal WebGL render failure observer failed",
      expect.any(Error),
    );

    stop();
    stopThrowing();
    vi.mocked(gl.clear).mockImplementationOnce(() => { throw undefined; });
    root.invalidate();
    expect(() => scheduled.shift()?.(32)).not.toThrow();
    expect(observed).toEqual([failure]);
    root.dispose();
  });
});
