import { vi } from "vitest";
import type {
  PickInput,
  PickResult,
  RenderRoot,
} from "@royal/renderer-core";
import type { RoyalRendererRoot } from "../packages/react/src/root";
import {
  createStrictWebGl2Context,
  createWebGlTestCanvas,
  type WebGlTestCanvas,
} from "./webgl-test-harness";

export type FakeCanvas = WebGlTestCanvas;

export const fakeWebGl2Context = (): WebGL2RenderingContext =>
  createStrictWebGl2Context().gl;

export const fakeCanvas = (
  gl: WebGL2RenderingContext = fakeWebGl2Context(),
): FakeCanvas => createWebGlTestCanvas(gl);

export const fakeRendererRoot = ({
  canvas = {} as HTMLCanvasElement,
  context = {
    alpha: true,
    antialias: true,
    generatedImageVirtualTextures: false,
    generatedSvgVirtualTextureRasterDensity: 4,
  },
  diagnostics = {},
  pick = () => undefined,
}: {
  readonly canvas?: HTMLCanvasElement;
  readonly context?: RoyalRendererRoot["context"];
  readonly diagnostics?: unknown;
  readonly pick?: (scene: RenderRoot | undefined, input: PickInput) => PickResult | undefined;
} = {}): RoyalRendererRoot => {
  let frame = 0;
  let latestScene: RenderRoot | undefined;
  const root: RoyalRendererRoot = {
    canvas,
    context,
    get disposed() {
      return false;
    },
    get frame() {
      return frame;
    },
    diagnostics: vi.fn(() => diagnostics as ReturnType<RoyalRendererRoot["diagnostics"]>),
    dispose: vi.fn(),
    flushInvalidated: vi.fn(),
    invalidate: vi.fn(),
    observeLifecycle: vi.fn((callback: Parameters<RoyalRendererRoot["observeLifecycle"]>[0]) => {
      callback({ generation: 1, lifecycle: "available" });
      return () => undefined;
    }),
    observeRenderFailures: vi.fn(() => () => undefined),
    pick: vi.fn((input: PickInput) => pick(latestScene, input)),
    render: vi.fn((scene: RenderRoot) => {
      latestScene = scene;
      frame += 1;
    }),
    snapshot: vi.fn(() => ({
      context: root.context,
      disposed: root.disposed,
      frame: root.frame,
      lifecycle: { generation: 1, lifecycle: "available" as const },
    })),
  };

  return root;
};
