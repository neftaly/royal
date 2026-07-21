import type { FramebufferSize } from "./clear-frame";
import type { ExternalFrameClock } from "./frame-clock-owner";
import type { SurfaceFrameView } from "./surface-frame";

/** @internal Capability keys keep the browser XR seam out of the base API surface. */
export const rendererAcquireExternalClock: unique symbol = Symbol("royal.webgl.external-clock");
export const rendererOwnedWebGl2Context: unique symbol = Symbol("royal.webgl.context");
export const rendererSubmitExternalFrame: unique symbol = Symbol("royal.webgl.external-frame");

export type ExternalSurfaceFrame = Readonly<{
  framebuffer: WebGLFramebuffer | null;
  size: FramebufferSize;
  views: readonly SurfaceFrameView[];
}>;

export interface ExternalFrameCapableRoot {
  [rendererAcquireExternalClock](): ExternalFrameClock;
  readonly [rendererOwnedWebGl2Context]: WebGL2RenderingContext;
  [rendererSubmitExternalFrame](frame: ExternalSurfaceFrame): boolean;
}
