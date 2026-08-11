import type {
  GltfNode,
  MeshNode,
  Transform,
} from "@royal/renderer-core";
import {
  affineSurfaceNormalTransformInto,
  identityMat4,
  inverseMat4Into,
  multiplyMat4Into,
  transformDirectionInto,
  transformMat4Into,
  transformPointInto,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import {
  canonicalModelHandedness,
  type CanonicalPickSurface,
  type CanonicalRenderObjectBinding,
  type CanonicalSurfaceScene,
} from "./scene-lowering";
import {
  includeTransformedBounds,
  includeWorldBounds,
  type MutableWorldBounds,
  type WorldBounds,
} from "./surface-visibility";

export type CanonicalRenderObjectUpdateWorkspace = Readonly<{
  affectedLodGroups: Set<number>;
  composedModel: MutableMat4;
  localModel: MutableMat4;
  rootModel: MutableMat4;
}>;

export const createCanonicalRenderObjectUpdateWorkspace = (
): CanonicalRenderObjectUpdateWorkspace => ({
  affectedLodGroups: new Set(),
  composedModel: identityMat4(),
  localModel: identityMat4(),
  rootModel: identityMat4(),
});

const LOCAL_FORWARD = [0, 0, -1] as const;
const LOCAL_ORIGIN = [0, 0, 0] as const;

const resetWorldBounds = (bounds: WorldBounds): MutableWorldBounds => {
  const mutable = bounds as MutableWorldBounds;
  mutable.min[0] = Infinity;
  mutable.min[1] = Infinity;
  mutable.min[2] = Infinity;
  mutable.max[0] = -Infinity;
  mutable.max[1] = -Infinity;
  mutable.max[2] = -Infinity;
  return mutable;
};

const copyArrayMat4Into = (
  out: MutableMat4,
  values: ArrayLike<number>,
  offset: number,
): MutableMat4 => {
  for (let index = 0; index < 16; index += 1) {
    out[index] = values[offset + index]!;
  }
  return out;
};

type MutablePickSurface = Omit<CanonicalPickSurface, "inverseModel"> & {
  inverseModel: Mat4 | undefined;
};

const updatePickSurface = (
  surface: CanonicalPickSurface,
  rootModel: Mat4,
  composedModel: MutableMat4,
): void => {
  const mutable = surface as MutablePickSurface;
  const objectLocalModel = surface.objectLocalModel;
  if (objectLocalModel === undefined) {
    throw new Error("Royal render-object picking metadata is incomplete");
  }
  multiplyMat4Into(composedModel, rootModel, objectLocalModel);
  const inverse = mutable.inverseModel ?? identityMat4();
  mutable.inverseModel = inverseMat4Into(inverse as MutableMat4, composedModel);
};

const refreshAffectedLodBounds = (
  scene: CanonicalSurfaceScene,
  binding: CanonicalRenderObjectBinding,
  workspace: CanonicalRenderObjectUpdateWorkspace,
): void => {
  const affected = workspace.affectedLodGroups;
  affected.clear();
  for (const surfaceIndex of binding.surfaceIndices) {
    for (const membership of scene.surfaces[surfaceIndex]!.lods ?? []) {
      affected.add(membership.group);
    }
  }
  for (const groupIndex of affected) {
    const group = scene.lodGroups[groupIndex];
    if (group === undefined) continue;
    const bounds = resetWorldBounds(group.selectionBounds);
    for (const surfaceIndex of group.surfaceIndices) {
      includeWorldBounds(bounds, scene.surfaces[surfaceIndex]!.worldBounds);
    }
  }
  affected.clear();
};

/**
 * Applies one validated imperative transform to lowering-owned retained data.
 * The returned binding identifies the exact GPU packets affected by the update.
 */
export const updateCanonicalRenderObjectTransform = (
  scene: CanonicalSurfaceScene,
  node: MeshNode | GltfNode,
  transform: Transform,
  workspace: CanonicalRenderObjectUpdateWorkspace,
): CanonicalRenderObjectBinding | undefined => {
  const binding = scene.renderObjects.get(node);
  if (binding === undefined) return undefined;
  const rootModel = transformMat4Into(workspace.rootModel, transform);
  for (const surfaceIndex of binding.surfaceIndices) {
    const surface = scene.surfaces[surfaceIndex]!;
    const objectLocalModel = surface.objectLocalModel;
    if (objectLocalModel === undefined) {
      throw new Error("Royal render-object surface metadata is incomplete");
    }
    const model = surface.model as MutableMat4;
    multiplyMat4Into(model, rootModel, objectLocalModel);
    affineSurfaceNormalTransformInto(surface.normalTransform as MutableMat4, model);
    (surface as { modelHandedness: 1 | -1 }).modelHandedness =
      canonicalModelHandedness(model);
    const bounds = resetWorldBounds(surface.worldBounds);
    const instances = surface.instances;
    if (instances === undefined) {
      includeTransformedBounds(bounds, surface.geometry.bounds, model);
      continue;
    }
    for (let offset = 0; offset < instances.localModels.length; offset += 16) {
      multiplyMat4Into(
        workspace.composedModel,
        rootModel,
        copyArrayMat4Into(workspace.localModel, instances.localModels, offset),
      );
      includeTransformedBounds(
        bounds,
        surface.geometry.bounds,
        workspace.composedModel,
      );
    }
  }
  for (const pickSurfaceIndex of binding.pickSurfaceIndices) {
    updatePickSurface(
      scene.pickSurfaces[pickSurfaceIndex]!,
      rootModel,
      workspace.composedModel,
    );
  }
  for (const lightBinding of binding.lights) {
    multiplyMat4Into(
      workspace.composedModel,
      rootModel,
      lightBinding.localModel,
    );
    if (lightBinding.kind === "directional") {
      const light = scene.directionalLights[lightBinding.index]!;
      transformDirectionInto(
        light.direction as [number, number, number],
        workspace.composedModel,
        LOCAL_FORWARD,
      );
    } else {
      const light = scene.punctualLights[lightBinding.index]!;
      transformDirectionInto(
        light.direction as [number, number, number],
        workspace.composedModel,
        LOCAL_FORWARD,
      );
      transformPointInto(
        light.position as [number, number, number],
        workspace.composedModel,
        LOCAL_ORIGIN,
      );
    }
  }
  refreshAffectedLodBounds(scene, binding, workspace);
  return binding;
};
