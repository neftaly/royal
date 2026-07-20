import type { Mat4 } from "../math/mat4";
import { mat4ValuesEqual } from "../math/mat4";
import type { TextureUnitBinding } from "../webgl/draw-state-transition";
import type { CanonicalSurfaceMaterial } from "./canonical-material";
import { canonicalSurfaceIsDoubleSided } from "./surface-pass-plan";

/** Minimal retained draw state that can participate in one indexed multi-draw call. */
export type SurfaceMultiDrawCandidate = Readonly<{
  bindings: readonly TextureUnitBinding[];
  geometry: Readonly<{ indexType: number }>;
  instanceCount: number;
  mode: number;
  program: Readonly<{ program: WebGLProgram }>;
  surface: Readonly<{
    material: CanonicalSurfaceMaterial;
    materialSource: CanonicalSurfaceMaterial;
    model: Mat4;
    modelHandedness: number;
  }>;
  textureUnits: number;
  vertexArray: WebGLVertexArrayObject;
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
  && left.program.program === right.program.program
  && left.mode === right.mode
  && left.surface.materialSource === right.surface.materialSource
  && left.surface.material.alphaBlend !== true
  && right.surface.material.alphaBlend !== true
  && canonicalSurfaceIsDoubleSided(left.surface.material)
    === canonicalSurfaceIsDoubleSided(right.surface.material)
  && left.surface.modelHandedness === right.surface.modelHandedness
  && mat4ValuesEqual(left.surface.model, right.surface.model)
  && left.textureUnits === right.textureUnits
  && left.vertexArray === right.vertexArray
  && left.geometry.indexType === right.geometry.indexType
  && textureBindingsEqual(left.bindings, right.bindings)
);
