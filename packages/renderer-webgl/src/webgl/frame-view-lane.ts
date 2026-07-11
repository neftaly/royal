import type { RenderRoot } from "@royal/renderer-core";
import type { FrameViews } from "../frame-views";

/** Internal lane for an imperative shell that already normalized its views. */
export const rendererFrameViews = Symbol("royal.renderer-frame-views");

export interface RendererFrameViewLane {
  [rendererFrameViews](scene: RenderRoot, frameViews: FrameViews): void;
}
