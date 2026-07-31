import {
  imageTexture,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "./support/wait-for";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  createWebXrSessionRendererWithPlatform,
  validateXrSessionRendererOptions,
  type XrReferenceSpace,
  type XrSession,
  type XrView,
  type XrWebGlLayer,
  type XrWebGlLayerOptions,
} from "../../packages/renderer-webgl/src/xr/session-renderer";
import { selectXrPreferredFrameRate } from "../../packages/renderer-webgl/src/xr/frame-rate";
import { canvasRootHarness } from "./support/canvas-root-harness";

class FakeSession extends EventTarget implements XrSession {
  readonly supportedFrameRates = new Float32Array([72, 90, 120]);
  readonly requestReferenceSpace = vi.fn(async (type: string) => {
    if (type === "local-floor") throw new Error("floor unavailable");
    return {} as XrReferenceSpace;
  });
  readonly updateRenderState = vi.fn();
  readonly updateTargetFrameRate = vi.fn(async () => undefined);
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
  it("selects a supported frame-rate preference without allocating policy state", () => {
    expect(selectXrPreferredFrameRate("highest", new Float32Array([72, 90, 120]))).toBe(120);
    expect(selectXrPreferredFrameRate(100, new Float32Array([72, 90, 110]))).toBe(90);
    expect(selectXrPreferredFrameRate(120, undefined)).toBe(120);
    expect(selectXrPreferredFrameRate("highest", undefined)).toBeUndefined();
    expect(() => selectXrPreferredFrameRate(0, [])).toThrow("positive finite number");
  });

  it("rejects hidden renderer option fields", () => {
    expect(() => validateXrSessionRendererOptions({
      [Symbol("hidden")]: true,
    })).toThrow("Royal XR renderer options has unsupported field Symbol(hidden)");
    expect(() => validateXrSessionRendererOptions({
      preferredFrameRate: 0,
    })).toThrow("preferredFrameRate must be highest or a positive finite number");
    expect(() => validateXrSessionRendererOptions({
      depthRange: { far: 10, near: 0 },
    })).toThrow("depthRange near must be a positive finite number");
    expect(() => validateXrSessionRendererOptions({
      depthRange: { far: 0.01, near: 0.01 },
    })).toThrow("depthRange far must be finite and greater than near");
    expect(() => validateXrSessionRendererOptions({
      depthRange: { far: 10, near: 0.01, scale: 1 },
    } as unknown as Parameters<typeof validateXrSessionRendererOptions>[0]))
      .toThrow("Royal XR depthRange has unsupported field scale");
  });

  it("installs one explicit projection depth range into browser-owned XR state", async () => {
    const { canvas, root } = canvasRootHarness();
    Object.assign(canvas.gl, { makeXRCompatible: vi.fn(async () => undefined) });
    const session = new FakeSession();

    const renderer = await createWebXrSessionRendererWithPlatform(
      root,
      session,
      { depthRange: { far: 20, near: 0.01 } },
      { layerConstructor: () => FakeLayer },
    );

    expect(session.updateRenderState).toHaveBeenCalledWith({
      baseLayer: renderer.layer,
      depthFar: 20,
      depthNear: 0.01,
    });
    renderer.dispose();
  });

  it("borrows one root context and submits both eyes in one frame transaction", async () => {
    const { callbacks, canvas, root } = canvasRootHarness();
    const makeXRCompatible = vi.fn(async () => undefined);
    Object.assign(canvas.gl, { makeXRCompatible });
    root.setScene(scene({
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
      {
        onFrameSnapshot: (snapshot) => snapshots.push(snapshot),
        preferredFrameRate: "highest",
      },
      { layerConstructor: () => FakeLayer },
    );

    expect(makeXRCompatible).toHaveBeenCalledTimes(1);
    expect(session.updateTargetFrameRate).toHaveBeenCalledWith(120);
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

  it("publishes textures which settle under external XR frame authority", async () => {
    let resolveDecode: ((source: {
      height: number;
      source: TexImageSource;
      width: number;
    }) => void) | undefined;
    const decodeTexture = vi.fn(() => new Promise<{
      height: number;
      source: TexImageSource;
      width: number;
    }>((resolve) => { resolveDecode = resolve; }));
    const texture = imageTexture("/xr-progressive.png");
    const { canvas, root } = canvasRootHarness({ decodeTexture });
    Object.assign(canvas.gl, { makeXRCompatible: vi.fn(async () => undefined) });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({
        geometry: planeGeometry([2, 1]),
        material: unlitMaterial({ texture }),
      })],
    }));
    const renderer = await createWebXrSessionRendererWithPlatform(
      root,
      new FakeSession(),
      {},
      { layerConstructor: () => FakeLayer },
    );
    const frame = { getViewerPose: () => ({ views: [LEFT_VIEW, RIGHT_VIEW] }) };
    renderer.renderFrame(frame);
    vi.mocked(canvas.gl.texSubImage2D).mockClear();

    resolveDecode?.({ height: 8, source: {} as ImageBitmap, width: 8 });
    await waitFor(() => expect(root.getTextureAssetSnapshot(texture).status).toBe("ready"));
    renderer.renderFrame(frame);

    expect(canvas.gl.texSubImage2D).toHaveBeenCalledOnce();
    renderer.dispose();
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

  it("constructs indexed matrix diagnostics only for invalid browser frame data", async () => {
    const { canvas, root } = canvasRootHarness();
    Object.assign(canvas.gl, { makeXRCompatible: vi.fn(async () => undefined) });
    const renderer = await createWebXrSessionRendererWithPlatform(
      root,
      new FakeSession(),
      {},
      { layerConstructor: () => FakeLayer },
    );
    const projection = identityMat4();
    projection[7] = Number.NaN;
    const invalid: XrView = {
      projectionMatrix: projection,
      transform: LEFT_VIEW.transform,
    };

    expect(() => renderer.renderFrame({ getViewerPose: () => ({ views: [invalid] }) }))
      .toThrow("Royal XR views[0].projection[7] must be finite");
    expect(canvas.gl.clear).not.toHaveBeenCalled();
    renderer.dispose();
  });
});
