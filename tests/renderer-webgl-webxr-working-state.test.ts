import { afterEach, describe, expect, it, vi } from "vitest";
import { createCameraViewResource, scene } from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import {
  createWebXrSessionRenderer,
  type WebGlXrFrameSnapshot,
  type WebGlXrLayerConstructor,
  type WebGlXrReferenceSpace,
  type WebGlXrSession,
  type WebGlXrView,
} from "@royal/renderer-webgl/webxr";
import {
  camera,
  cube,
  drawCalls,
  drawableScene,
  expectMatricesToContainClose,
  fakeCanvas,
  fakeGl,
  makeHandle,
  xrSessionEventMethods,
} from "./renderer-webgl-working-state-runtime";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL root WebXR working state contracts", () => {
  it("rejects invalid public WebXR options before renderer setup", async () => {
    const root = {} as Parameters<typeof createWebXrSessionRenderer>[0];
    const session = {} as WebGlXrSession;

    await expect(createWebXrSessionRenderer(root, session, {
      referenceSpacePreference: [],
    })).rejects.toThrow("must contain at least one reference space type");
    await expect(createWebXrSessionRenderer(root, session, {
      webGlLayer: { framebufferScaleFactor: 0 },
    })).rejects.toThrow("framebufferScaleFactor must be positive and finite");
    await expect(createWebXrSessionRenderer(root, session, {
      // @ts-expect-error Runtime validation protects JavaScript callers.
      referenceSpacePreference: ["stage"],
    })).rejects.toThrow("entries must be one of");
    await expect(createWebXrSessionRenderer(
      root,
      session,
      null as unknown as Parameters<typeof createWebXrSessionRenderer>[2],
    )).rejects.toThrow("Royal WebXR options must be an object");
    await expect(createWebXrSessionRenderer(root, session, {
      layerOptions: {},
    } as unknown as Parameters<typeof createWebXrSessionRenderer>[2]))
      .rejects.toThrow(/unsupported option.*layerOptions/i);
    await expect(createWebXrSessionRenderer(root, session, {
      onFrameSnapshot: true,
    } as unknown as Parameters<typeof createWebXrSessionRenderer>[2]))
      .rejects.toThrow("onFrameSnapshot must be a function");
    await expect(createWebXrSessionRenderer(root, session, {
      referenceSpacePreference: "local",
    } as unknown as Parameters<typeof createWebXrSessionRenderer>[2]))
      .rejects.toThrow("referenceSpacePreference must be an array");
    await expect(createWebXrSessionRenderer(root, session, {
      webGlLayer: { antiAlias: true },
    } as unknown as Parameters<typeof createWebXrSessionRenderer>[2]))
      .rejects.toThrow(/webGlLayer options.*unsupported option.*antiAlias/i);
  });

  it("renders caller-owned views with supplied matrices and scissored viewports", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const framebuffer = makeHandle<WebGLFramebuffer>();
    const projection = [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, -1, -1,
      0, 0, -0.1, 0,
    ];
    const view = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.25, -0.5, -2, 1,
    ];
    const rightProjection = [...projection];
    rightProjection[0] = 4;
    const rightView = [...view];
    rightView[12] = -0.25;

    root.renderViews(drawableScene([0, 0, 0, 0]), {
      framebuffer,
      views: [
        { projectionMatrix: projection, viewMatrix: view, viewport: { height: 80, width: 100, x: 0, y: 0 } },
        {
          projectionMatrix: rightProjection,
          viewMatrix: rightView,
          viewport: { height: 80, width: 100, x: 100, y: 0 },
        },
      ],
    });

    const framebufferBinds = calls.filter((call) => call.name === "bindFramebuffer");
    expect(framebufferBinds[0]?.args).toEqual([gl.FRAMEBUFFER, framebuffer]);
    expect(calls.filter((call) => call.name === "viewport").map((call) => call.args)).toEqual([
      [0, 0, 100, 80],
      [100, 0, 100, 80],
    ]);
    expect(calls.filter((call) => call.name === "scissor").map((call) => call.args)).toEqual([
      [0, 0, 100, 80],
      [100, 0, 100, 80],
    ]);
    expect(drawCalls(calls)).toHaveLength(2);

    const uniformMatrices = calls
      .filter((call) => call.name === "uniformMatrix4fv")
      .map((call) => Array.from(call.args[2] as ArrayLike<number>));
    expectMatricesToContainClose(uniformMatrices, projection);
    expectMatricesToContainClose(uniformMatrices, view);
    expectMatricesToContainClose(uniformMatrices, rightProjection);
    expectMatricesToContainClose(uniformMatrices, rightView);
  });

  it("rejects a public WebGlRoot-shaped value without private XR capabilities", async () => {
    const publicOnlyRoot = {
      contextLifecycle: "active",
    } as Parameters<typeof createWebXrSessionRenderer>[0];
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(),
      updateRenderState: vi.fn(),
    };

    await expect(createWebXrSessionRenderer(publicOnlyRoot, session)).rejects.toThrow(
      "requires a Royal WebGL root with renderer-owned context and frame-view capabilities",
    );
    expect(session.updateRenderState).not.toHaveBeenCalled();
  });

  it("rejects WebXR setup when the WebGL context cannot become XR-compatible", async () => {
    const { gl } = fakeGl();
    const xrGl = gl as WebGL2RenderingContext & {
      makeXRCompatible?: () => Promise<void>;
    };
    delete xrGl.makeXRCompatible;
    const root = createWebGlRoot(fakeCanvas(gl));
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(),
      updateRenderState: vi.fn(),
    };

    await expect(createWebXrSessionRenderer(root, session)).rejects.toThrow(
      "requires WebGL makeXRCompatible support",
    );
    expect(session.requestReferenceSpace).not.toHaveBeenCalled();
    expect(session.updateRenderState).not.toHaveBeenCalled();
    root.dispose();
  });

  it("creates a WebXR session renderer that renders the latest scene through XR views", async () => {
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const framebuffer = makeHandle<WebGLFramebuffer>();
    const referenceSpace: WebGlXrReferenceSpace = {};
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => referenceSpace),
      updateRenderState: vi.fn(),
    };
    let layerContext: WebGL2RenderingContext | undefined;
    let layerOptions: unknown;
    const xrWebGLLayerConstructor: WebGlXrLayerConstructor = class {
      readonly context: WebGL2RenderingContext;
      readonly framebuffer = framebuffer;
      readonly options: unknown | undefined;
      readonly session: WebGlXrSession;
      constructor(
        session: WebGlXrSession,
        context: WebGL2RenderingContext,
        options?: unknown,
      ) {
        this.context = context;
        this.options = options;
        this.session = session;
        layerContext = context;
        layerOptions = options;
      }
      getViewport(view: WebGlXrView) {
        return (view as WebGlXrView & {
          readonly viewport: { readonly height: number; readonly width: number; readonly x: number; readonly y: number };
        }).viewport;
      }
    };
    const projectionMatrix = [
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, -1, -1,
      0, 0, -0.1, 0,
    ];
    const viewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, -1, -3, 1,
    ];
    const xrViewport = { height: 90, width: 110, x: 4, y: 8 };
    const snapshots: WebGlXrFrameSnapshot[] = [];
    const onFrameSnapshot = vi.fn((snapshot: WebGlXrFrameSnapshot) => {
      snapshots.push(snapshot);
    });

    const cameraResource = createCameraViewResource(camera());
    root.render(scene({
      camera: cameraResource,
      clearColor: [0, 0, 0, 0],
      nodes: [cube([1, 1, 1, 1])],
    }));
    const contextAcquisitionsBeforeXr = canvas.getContext.mock.calls.length;
    const renderer = await createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor },
      onFrameSnapshot,
      referenceSpacePreference: ["local"],
      webGlLayer: { antialias: true, framebufferScaleFactor: 0.85 },
    });
    expect(canvas.getContext).toHaveBeenCalledTimes(contextAcquisitionsBeforeXr);
    expect(layerContext).toBe(gl);
    expect(layerOptions).toEqual({ antialias: true, framebufferScaleFactor: 0.85 });
    cameraResource.position[0] = 10_000;
    cameraResource.commit();
    const callsBeforeXrFrame = calls.length;
    const rendered = renderer.renderFrame({
      getViewerPose: (space) => {
        expect(space).toBe(referenceSpace);
        return {
          views: [{
            projectionMatrix,
            transform: { inverse: { matrix: viewMatrix } },
            viewport: xrViewport,
          }],
        };
      },
    });
    const xrCalls = calls.slice(callsBeforeXrFrame);

    expect(rendered).toBe(true);
    expect((gl as WebGL2RenderingContext & {
      readonly makeXRCompatible: ReturnType<typeof vi.fn>;
    }).makeXRCompatible).toHaveBeenCalled();
    expect(session.updateRenderState).toHaveBeenCalledWith({ baseLayer: renderer.layer });
    expect(session.requestReferenceSpace).toHaveBeenCalledWith("local");
    expect(onFrameSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshots).toEqual([{
      frameIndex: 0,
      viewports: [xrViewport],
    }]);
    expect(snapshots[0]?.viewports[0]).not.toBe(xrViewport);
    expect(xrCalls.filter((call) => call.name === "bindFramebuffer")[0]?.args).toEqual([gl.FRAMEBUFFER, framebuffer]);
    expect(xrCalls.filter((call) => call.name === "viewport").map((call) => call.args)).toEqual([[4, 8, 110, 90]]);
    expect(drawCalls(xrCalls)).toHaveLength(1);
    const xrMatrices = xrCalls
      .filter((call) => call.name === "uniformMatrix4fv")
      .map((call) => Array.from(call.args[2] as ArrayLike<number>));
    expectMatricesToContainClose(xrMatrices, projectionMatrix);
    expectMatricesToContainClose(xrMatrices, viewMatrix);
    expect(renderer.disposed).toBe(false);

    canvas.dispatchContextEvent("webglcontextlost");
    const callsWhileLost = calls.length;
    expect(renderer.renderFrame({
      getViewerPose: () => ({
        views: [{
          projectionMatrix,
          transform: { inverse: { matrix: viewMatrix } },
          viewport: xrViewport,
        }],
      }),
    })).toBe(false);
    expect(calls).toHaveLength(callsWhileLost);
    expect(onFrameSnapshot).toHaveBeenCalledTimes(1);

    renderer.dispose();
    renderer.dispose();

    expect(renderer.disposed).toBe(true);
    expect(renderer.renderFrame({ getViewerPose: () => null })).toBe(false);
    expect(calls.filter((call) => call.name === "deleteFramebuffer" && call.args[0] === framebuffer)).toHaveLength(0);
  });

  it("releases the XR renderer automatically when its session ends", async () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const referenceSpace: WebGlXrReferenceSpace = {};
    const events = new EventTarget();
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => referenceSpace),
      updateRenderState: vi.fn(),
    };
    const xrWebGLLayerConstructor: WebGlXrLayerConstructor = class {
      readonly framebuffer = null;
      getViewport() {
        return null;
      }
    };
    const renderer = await createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor },
    });

    events.dispatchEvent(new Event("end"));

    expect(renderer.disposed).toBe(true);
    expect(renderer.renderFrame({ getViewerPose: () => null })).toBe(false);
    expect(() => renderer.dispose()).not.toThrow();
  });

  it("rejects XR setup when the session ends during an asynchronous setup step", async () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const events = new EventTarget();
    let finishCompatibility: (() => void) | undefined;
    (gl as WebGL2RenderingContext & {
      readonly makeXRCompatible: ReturnType<typeof vi.fn>;
    }).makeXRCompatible.mockImplementation(() => new Promise<void>((resolve) => {
      finishCompatibility = resolve;
    }));
    const session: WebGlXrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => ({})),
      updateRenderState: vi.fn(),
    };
    const creation = createWebXrSessionRenderer(root, session, {
      advanced: { xrWebGLLayerConstructor: class {
        readonly framebuffer = null;
        getViewport() {
          return null;
        }
      } },
    });

    events.dispatchEvent(new Event("end"));
    finishCompatibility?.();

    await expect(creation).rejects.toThrow("session ended during renderer setup");
    expect(session.updateRenderState).not.toHaveBeenCalled();
  });

});
