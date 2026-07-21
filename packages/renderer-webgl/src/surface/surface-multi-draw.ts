import type { Mat4 } from "../math/mat4";
import { mat4ValuesEqual } from "../math/mat4";
import type {
  SurfaceDrawPacket,
  TextureUnitBinding,
} from "../webgl/draw-state-transition";
import type { CanonicalSurfaceMaterial } from "./canonical-material";

export type WebGlMultiDraw = Readonly<{
  multiDrawElementsWEBGL: (
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    drawCount: number,
  ) => void;
}>;

/** Minimal retained draw state that can participate in one indexed multi-draw call. */
export type SurfaceMultiDrawCandidate = Readonly<{
  drawPacket: SurfaceDrawPacket;
  geometry: Readonly<{ indexType: number }>;
  instanceCount: number;
  mode: number;
  surface: Readonly<{
    materialSource: CanonicalSurfaceMaterial;
    model: Mat4;
  }>;
}>;

export type SurfaceDepthMultiDrawCandidate = Readonly<{
  depthPacket: SurfaceDrawPacket | null;
  geometry: Readonly<{ indexType: number }>;
  instanceCount: number;
  mode: number;
  surface: Readonly<{ model: Mat4 }>;
}>;

export const activeTextureBindingsEqual = (
  left: readonly TextureUnitBinding[],
  right: readonly TextureUnitBinding[],
  textureUnits: number,
): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if ((textureUnits & (1 << index)) === 0) continue;
    if (
      left[index]!.sampler !== right[index]!.sampler
      || left[index]!.target !== right[index]!.target
      || left[index]!.texture !== right[index]!.texture
    ) return false;
  }
  return true;
};

/**
 * Whether two adjacent surfaces can share every state and uniform write around
 * one multi-draw call. Material source identity is intentionally strict:
 * semantic similarity cannot make distinct textures or factors interchangeable.
 */
export const surfacesShareMultiDrawState = (
  left: SurfaceMultiDrawCandidate,
  right: SurfaceMultiDrawCandidate,
): boolean => (
  left.instanceCount === 0
  && right.instanceCount === 0
  && left.drawPacket.program === right.drawPacket.program
  && left.mode === right.mode
  && left.surface.materialSource === right.surface.materialSource
  && left.drawPacket.alphaBlend === right.drawPacket.alphaBlend
  && left.drawPacket.colorWrite === right.drawPacket.colorWrite
  && left.drawPacket.cullBackFaces === right.drawPacket.cullBackFaces
  && left.drawPacket.depthTest === right.drawPacket.depthTest
  && left.drawPacket.depthWrite === right.drawPacket.depthWrite
  && left.drawPacket.frontFace === right.drawPacket.frontFace
  && mat4ValuesEqual(left.surface.model, right.surface.model)
  && left.drawPacket.textureUnits === right.drawPacket.textureUnits
  && left.drawPacket.vertexArray === right.drawPacket.vertexArray
  && left.geometry.indexType === right.geometry.indexType
  && activeTextureBindingsEqual(
    left.drawPacket.textureBindings,
    right.drawPacket.textureBindings,
    left.drawPacket.textureUnits,
  )
);

/** Exact retained-state equivalence for a position-only opaque multi-draw. */
export const surfacesShareDepthPrepassState = (
  left: SurfaceDepthMultiDrawCandidate,
  right: SurfaceDepthMultiDrawCandidate,
): boolean => {
  const leftPacket = left.depthPacket;
  const rightPacket = right.depthPacket;
  return leftPacket !== null
    && rightPacket !== null
    && left.instanceCount === 0
    && right.instanceCount === 0
    && leftPacket.program === rightPacket.program
    && left.mode === right.mode
    && leftPacket.cullBackFaces === rightPacket.cullBackFaces
    && leftPacket.frontFace === rightPacket.frontFace
    && leftPacket.vertexArray === rightPacket.vertexArray
    && left.geometry.indexType === right.geometry.indexType
    && mat4ValuesEqual(left.surface.model, right.surface.model);
};
