export { createRendererRoot } from "./runtime/canvas-root";
export { rendererRootOptionsSemanticKey } from "./runtime/root-options";
export type {
  CanvasRoot as RoyalRendererRoot,
  CanvasRootOptions as RendererRootOptions,
  CanvasRootSnapshot as RendererRootSnapshot,
} from "./runtime/canvas-root";
export type { CanvasSizeInput, ResolvedCanvasSize } from "./frame/canvas-size";
export type { ExternalFrameClock } from "./frame/frame-clock-owner";
export type { PickInput, PickResult } from "@royal/renderer-core";
