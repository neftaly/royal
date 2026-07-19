import { describe, expect, it, vi } from "vitest";
import type { XrFrame, XrReferenceSpace, XrSessionRenderer } from "@royal/renderer-webgl/xr";
import {
  createXrSessionControllerWithPlatform,
  type BrowserXrSession,
  type BrowserXrSystem,
} from "../../packages/react/src/xr/session-controller";
import {
  initialXrSessionSnapshot,
  reduceXrSessionSnapshot,
} from "../../packages/react/src/xr/session-state";
import { canvasRootHarness } from "./support/canvas-root-harness";

class FakeBrowserSession extends EventTarget implements BrowserXrSession {
  visibilityState: "visible" | "hidden" = "visible";
  readonly callbacks = new Map<number, (time: number, frame: XrFrame) => void>();
  readonly cancelAnimationFrame = vi.fn((handle: number) => this.callbacks.delete(handle));
  readonly end = vi.fn(async () => undefined);
  readonly requestReferenceSpace = vi.fn(async () => ({} as XrReferenceSpace));
  readonly updateRenderState = vi.fn();
  #nextHandle = 1;

  requestAnimationFrame(callback: (time: number, frame: XrFrame) => void): number {
    const handle = this.#nextHandle;
    this.#nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  runFrame(frame: XrFrame): void {
    const [entry] = this.callbacks;
    if (entry === undefined) throw new Error("expected one scheduled XR frame");
    this.callbacks.delete(entry[0]);
    entry[1](0, frame);
  }
}

const fakeRenderer = (): XrSessionRenderer => {
  let disposed = false;
  return {
    get disposed() { return disposed; },
    layer: {} as XrSessionRenderer["layer"],
    referenceSpace: {} as XrReferenceSpace,
    dispose: vi.fn(() => { disposed = true; }),
    renderFrame: vi.fn(() => true),
  };
};

describe("XR session state", () => {
  it("keeps hidden sessions live and restores a rejected end request", () => {
    let state = initialXrSessionSnapshot("immersive-vr");
    state = reduceXrSessionSnapshot(state, { kind: "availability", supported: true });
    state = reduceXrSessionSnapshot(state, { kind: "begin" });
    state = reduceXrSessionSnapshot(state, { kind: "activate", visibilityState: "visible" });
    state = reduceXrSessionSnapshot(state, { kind: "visibility", visibilityState: "hidden" });
    expect(state.status).toBe("suspended");
    state = reduceXrSessionSnapshot(state, { kind: "begin-end" });
    state = reduceXrSessionSnapshot(state, { error: "denied", kind: "end-failed" });
    expect(state).toMatchObject({ error: "denied", status: "suspended" });
  });
});

describe("XR session controller", () => {
  it("coalesces acquisition, owns one RAF chain, and retains a hidden session", async () => {
    const { root } = canvasRootHarness();
    const session = new FakeBrowserSession();
    const renderer = fakeRenderer();
    const system: BrowserXrSystem = {
      isSessionSupported: vi.fn(async () => true),
      requestSession: vi.fn(async () => session),
    };
    const controller = createXrSessionControllerWithPlatform(root, {}, {
      createRenderer: vi.fn(async () => renderer),
      xrSystem: () => system,
    });
    const first = controller.enter();
    const second = controller.enter();
    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(system.requestSession).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().status).toBe("active");
    expect(session.callbacks.size).toBe(1);

    session.runFrame({ getViewerPose: () => null });
    expect(renderer.renderFrame).toHaveBeenCalledTimes(1);
    expect(session.callbacks.size).toBe(1);
    session.visibilityState = "hidden";
    session.dispatchEvent(new Event("visibilitychange"));
    expect(controller.getSnapshot().status).toBe("suspended");

    await controller.exit();
    expect(controller.getSnapshot().status).toBe("available");
    expect(renderer.disposed).toBe(true);
    expect(session.callbacks.size).toBe(0);
  });

  it("restores a usable session when browser end rejects", async () => {
    const { root } = canvasRootHarness();
    const session = new FakeBrowserSession();
    session.end.mockRejectedValueOnce(new Error("still live"));
    const controller = createXrSessionControllerWithPlatform(root, {}, {
      createRenderer: async () => fakeRenderer(),
      xrSystem: () => ({
        isSessionSupported: async () => true,
        requestSession: async () => session,
      }),
    });
    await controller.enter();
    await expect(controller.exit()).rejects.toThrow("still live");
    expect(controller.getSnapshot()).toMatchObject({ error: "still live", status: "active" });
    expect(session.callbacks.size).toBe(1);
  });

  it("ends the browser session and reports failure when its renderer root is lost", async () => {
    const { canvas, root } = canvasRootHarness();
    const session = new FakeBrowserSession();
    const renderer = fakeRenderer();
    const controller = createXrSessionControllerWithPlatform(root, {}, {
      createRenderer: async () => renderer,
      xrSystem: () => ({
        isSessionSupported: async () => true,
        requestSession: async () => session,
      }),
    });
    await controller.enter();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.getSnapshot()).toMatchObject({ status: "error" });
    expect(renderer.disposed).toBe(true);
    expect(session.end).toHaveBeenCalledTimes(1);
  });
});
