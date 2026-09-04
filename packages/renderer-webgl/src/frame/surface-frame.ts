import type { Mat4 } from "../math/mat4";
import type { FrameViewport } from "./clear-frame";

/** Shared immutable view intent consumed by canvas, XR, surfaces, and optional VT. */
export type SurfaceFrameView = Readonly<{
  /** Projection semantics supplied by external view owners such as WebXR. */
  perspective?: boolean | undefined;
  view: Mat4;
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;
