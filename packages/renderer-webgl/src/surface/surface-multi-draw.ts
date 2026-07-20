import type { Mat4 } from "../math/mat4";
import { mat4ValuesEqual } from "../math/mat4";
import type {
  SurfaceDrawPacket,
  TextureUnitBinding,
} from "../webgl/draw-state-transition";
import type { CanonicalSurfaceMaterial } from "./canonical-material";

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

const textureBindingsEqual = (
  left: readonly TextureUnitBinding[],
  right: readonly TextureUnitBinding[],
): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
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
  && left.drawPacket.cullBackFaces === right.drawPacket.cullBackFaces
  && left.drawPacket.depthTest === right.drawPacket.depthTest
  && left.drawPacket.depthWrite === right.drawPacket.depthWrite
  && left.drawPacket.frontFace === right.drawPacket.frontFace
  && mat4ValuesEqual(left.surface.model, right.surface.model)
  && left.drawPacket.textureUnits === right.drawPacket.textureUnits
  && left.drawPacket.vertexArray === right.drawPacket.vertexArray
  && left.geometry.indexType === right.geometry.indexType
  && textureBindingsEqual(left.drawPacket.textureBindings, right.drawPacket.textureBindings)
);
