import { mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  createWebXrSessionRendererWithPlatform,
  type XrReferenceSpace,
  type XrSession,
  type XrView,
  type XrWebGlLayer,
  type XrWebGlLayerOptions,
} from "../../packages/renderer-webgl/src/xr/session-renderer";
import { canvasRootHarness } from "./support/canvas-root-harness";

class FakeSession extends EventTarget implements XrSession {
  readonly requestReferenceSpace = vi.fn(async (type: string) => {
    if (type === "local-floor") throw new Error("floor unavailable");
    return {} as XrReferenceSpace;
  });
  readonly updateRenderState = vi.fn();
}

class FakeLayer implements XrWebGlLayer {
  static options: XrWebGlLayerOptions | undefined;
  readonly framebuffer = {} as WebGLFramebuffer;
  framebufferHeight = 100;
  framebufferWidth = 200;

  constructor(
    _session: XrSession,
    _gl: WebGL2RenderingContext,
    options?: XrWebGlLayerOptions,
  ) {
    FakeLayer.options = options;
  }

  getViewport(view: XrView) {
    return view === LEFT_VIEW
      ? { height: 100, width: 100, x: 0, y: 0 }
      : { height: 100, width: 100, x: 100, y: 0 };
  }
}

const LEFT_VIEW: XrView = {
  projectionMatrix: identityMat4(),
  transform: { inverse: { matrix: identityMat4() } },
};
const RIGHT_VIEW: XrView = {
  projectionMatrix: identityMat4(),
  transform: { inverse: { matrix: identityMat4() } },
};

describe("WebXR session renderer", () => {
  it("borrows one root context and submits both eyes in one frame transaction", async () => {
    const { callbacks, canvas, root } = canvasRootHarness();
    const makeXRCompatible = vi.fn(async () => undefined);
    Object.assign(canvas.gl, { makeXRCompatible });
    root.render(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      })],
    }));
    const session = new FakeSession();
    const snapshots: unknown[] = [];
    const renderer = await createWebXrSessionRendererWithPlatform(
      root,
      session,
      { onFrameSnapshot: (snapshot) => snapshots.push(snapshot) },
      { layerConstructor: () => FakeLayer },
    );

    expect(makeXRCompatible).toHaveBeenCalledTimes(1);
    expect(FakeLayer.options).toEqual({ antialias: false });
    expect(session.requestReferenceSpace.mock.calls.map(([type]) => type))
      .toEqual(["local-floor", "local"]);
    expect(renderer.renderFrame({ getViewerPose: () => ({ views: [LEFT_VIEW, RIGHT_VIEW] }) }))
      .toBe(true);
    expect(canvas.gl.clear).toHaveBeenCalledTimes(1);
    expect(canvas.gl.drawElements).toHaveBeenCalledTimes(2);
    expect(canvas.gl.viewport.mock.calls).toEqual(expect.arrayContaining([
      [0, 0, 200, 100],
      [0, 0, 100, 100],
      [100, 0, 100, 100],
    ]));
    expect(snapshots).toEqual([{
      frameIndex: 0,
      viewports: [
        { height: 100, width: 100, x: 0, y: 0 },
        { height: 100, width: 100, x: 100, y: 0 },
      ],
    }]);

    // The ordinary callback was superseded by external clock authority.
    callbacks.shift()!();
    expect(canvas.gl.clear).toHaveBeenCalledTimes(1);
    renderer.dispose();
    expect(renderer.disposed).toBe(true);
  });

  it("re-establishes Royal state after external runtime work and releases on context loss", async () => {
    const { canvas, root } = canvasRootHarness();
    Object.assign(canvas.gl, { makeXRCompatible: vi.fn(async () => undefined) });
    const session = new FakeSession();
    const renderer = await createWebXrSessionRendererWithPlatform(
      root,
      session,
      {},
      { layerConstructor: () => FakeLayer },
    );
    const frame = { getViewerPose: () => ({ views: [LEFT_VIEW, RIGHT_VIEW] }) };
    renderer.renderFrame(frame);
    renderer.renderFrame(frame);
    expect(canvas.gl.bindFramebuffer).toHaveBeenCalledTimes(2);

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(renderer.disposed).toBe(true);
    expect(renderer.renderFrame(frame)).toBe(false);
  });

  it("does not submit or allocate telemetry when the viewer pose is unavailable", async () => {
    const { canvas, root } = canvasRootHarness();
    Object.assign(canvas.gl, { makeXRCompatible: vi.fn(async () => undefined) });
    const session = new FakeSession();
    const renderer = await createWebXrSessionRendererWithPlatform(
      root,
      session,
      {},
      { layerConstructor: () => FakeLayer },
    );
    expect(renderer.renderFrame({ getViewerPose: () => null })).toBe(false);
    expect(canvas.gl.clear).not.toHaveBeenCalled();
    session.dispatchEvent(new Event("end"));
    expect(renderer.disposed).toBe(true);
  });
});
