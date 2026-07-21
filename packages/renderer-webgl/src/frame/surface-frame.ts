import type { Mat4 } from "../math/mat4";
import type { FrameViewport } from "./clear-frame";

/** Shared immutable view intent consumed by canvas, XR, surfaces, and optional VT. */
export type SurfaceFrameView = Readonly<{
  view: Mat4;
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;
