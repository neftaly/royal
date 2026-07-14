import { afterEach, describe, expect, it, vi } from "vitest";
import { perspectiveCamera, scene } from "@royal/renderer-core";
import { createRendererRoot } from "@royal/react";
import {
  createXrSessionRenderer,
  type XrReferenceSpace,
  type XrSession,
  type XrView,
} from "@royal/react/xr";
import { fakeCanvas, fakeRendererRoot } from "./react-test-fixtures";
import { createStrictWebGl2Context } from "./webgl-test-harness";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const xrSessionEventMethods = (target: EventTarget) => ({
  addEventListener: target.addEventListener.bind(target),
  cancelAnimationFrame: vi.fn(),
  end: vi.fn(async () => undefined),
  removeEventListener: target.removeEventListener.bind(target),
  requestAnimationFrame: vi.fn(() => 1),
});

describe("React XR renderer capability", () => {
  it("renders XR frames without exposing the concrete WebGL root", async () => {
    const makeXRCompatible = vi.fn(async () => undefined);
    const { gl } = createStrictWebGl2Context({
      methods: { makeXRCompatible, scissor: () => undefined },
    });
    const root = createRendererRoot(fakeCanvas(gl));
    root.render(scene({
      camera: perspectiveCamera({
        far: 10,
        fovY: Math.PI / 3,
        near: 0.1,
        position: [0, 0, 2],
        rotation: [0, 0, 0],
      }),
      nodes: [],
    }));

    const referenceSpace: XrReferenceSpace = {};
    const events = new EventTarget();
    const session: XrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(async () => referenceSpace),
      updateRenderState: vi.fn(),
    };
    class TestXrWebGlLayer {
      readonly framebuffer = null;
      getViewport(_view: XrView) {
        return { height: 90, width: 110, x: 4, y: 8 };
      }
    }
    vi.stubGlobal("XRWebGLLayer", TestXrWebGlLayer);

    const renderer = await createXrSessionRenderer(root, session, {
      referenceSpacePreference: ["local"],
    });
    const rendered = renderer.renderFrame({
      getViewerPose: (space) => {
        expect(space).toBe(referenceSpace);
        return {
          views: [{
            projectionMatrix: [
              2, 0, 0, 0,
              0, 2, 0, 0,
              0, 0, -1, -1,
              0, 0, -0.1, 0,
            ],
            transform: {
              inverse: {
                matrix: [
                  1, 0, 0, 0,
                  0, 1, 0, 0,
                  0, 0, 1, 0,
                  0, 0, -2, 1,
                ],
              },
            },
          }],
        };
      },
    });

    expect(rendered).toBe(true);
    expect(makeXRCompatible).toHaveBeenCalledTimes(1);
    expect(session.requestReferenceSpace).toHaveBeenCalledWith("local");
    expect(session.updateRenderState).toHaveBeenCalledTimes(1);

    renderer.dispose();
    root.dispose();
  });

  it("rejects roots without the optional XR integration capability", async () => {
    const root = fakeRendererRoot();
    const events = new EventTarget();
    const session: XrSession = {
      ...xrSessionEventMethods(events),
      requestReferenceSpace: vi.fn(),
      updateRenderState: vi.fn(),
    };

    await expect(createXrSessionRenderer(root, session)).rejects.toThrow(
      "does not provide the required integration capabilities",
    );
  });
});
