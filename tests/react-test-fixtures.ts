import { vi } from "vitest";
import type {
  PickInput,
  PickResult,
  RenderRoot,
} from "@royal/renderer-core";
import type { RoyalRendererRoot } from "../packages/react/src/root";
import { resolveWebGlRootOptions } from "../packages/renderer-webgl/src/root-options";
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
  options = {
    alpha: true,
    antialias: true,
    automaticVirtualTextures: false,
    resourceBudgets: resolveWebGlRootOptions().resourceBudgets,
  },
  diagnostics = {},
  pick = () => undefined,
}: {
  readonly canvas?: HTMLCanvasElement;
  readonly options?: RoyalRendererRoot["options"];
  readonly diagnostics?: unknown;
  readonly pick?: (scene: RenderRoot | undefined, input: PickInput) => PickResult | undefined;
} = {}): RoyalRendererRoot => {
  let frame = 0;
  let latestScene: RenderRoot | undefined;
  const frameObservers = new Set<(frame: number) => void>();
  const root: RoyalRendererRoot = {
    canvas,
    get disposed() {
      return false;
    },
    get frame() {
      return frame;
    },
    options,
    diagnostics: vi.fn(() => diagnostics as ReturnType<RoyalRendererRoot["diagnostics"]>),
    dispose: vi.fn(),
    flushInvalidated: vi.fn(),
    gltfAssetSnapshot: vi.fn(() => ({ state: "idle" as const, variantNames: [] })),
    textureAssetSnapshot: vi.fn((texture) => texture.kind === "asset"
      ? { kind: "ordinary" as const, state: "idle" as const }
      : { kind: "virtual" as const, pendingPages: 0, state: "idle" as const }),
    invalidate: vi.fn(),
    observeLifecycle: vi.fn((callback: Parameters<RoyalRendererRoot["observeLifecycle"]>[0]) => {
      callback({ generation: 1, interruptions: 0, recoveries: 0, state: "available" });
      return () => undefined;
    }),
    observeFrame: vi.fn((callback: Parameters<RoyalRendererRoot["observeFrame"]>[0]) => {
      callback(frame);
      frameObservers.add(callback);
      return () => frameObservers.delete(callback);
    }),
    observeGltfAsset: vi.fn((asset, callback) => {
      callback(root.gltfAssetSnapshot(asset));
      return () => undefined;
    }),
    observeTextureAsset: vi.fn((texture, callback) => {
      callback(root.textureAssetSnapshot(texture));
      return () => undefined;
    }),
    observeRenderFailures: vi.fn(() => () => undefined),
    pick: vi.fn((input: PickInput) => pick(latestScene, input)),
    render: vi.fn((scene: RenderRoot) => {
      latestScene = scene;
      frame += 1;
      for (const observer of frameObservers) observer(frame);
    }),
    snapshot: vi.fn(() => ({
      frame: root.frame,
      lifecycle: {
        generation: 1,
        interruptions: 0,
        recoveries: 0,
        state: "available" as const,
      },
      options: root.options,
    })),
  };

  return root;
};
