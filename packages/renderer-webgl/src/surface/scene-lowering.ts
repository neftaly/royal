import type {
  Camera,
  LinearRgba,
  MeshNode,
  RenderRoot,
} from "@royal/renderer-core";
import { inverseMat4, transformMat4, type Mat4 } from "../math/mat4";
import {
  prepareCanonicalGeometry,
  type CanonicalTriangleGeometry,
} from "./canonical-geometry";

export type CanonicalSurface = Readonly<{
  color: LinearRgba;
  geometry: CanonicalTriangleGeometry;
  inverseModel: Mat4 | undefined;
  model: Mat4;
  modelHandedness: 1 | -1;
  node: MeshNode;
  pickingGeometry: CanonicalTriangleGeometry;
}>;

export type CanonicalSurfaceScene = Readonly<{
  camera: Camera;
  surfaces: readonly CanonicalSurface[];
}>;

const modelHandedness = (model: Mat4): 1 | -1 => {
  const determinant = model[0] * (model[5] * model[10] - model[6] * model[9])
    - model[4] * (model[1] * model[10] - model[2] * model[9])
    + model[8] * (model[1] * model[6] - model[2] * model[5]);
  return determinant < 0 ? -1 : 1;
};

const staticCamera = (scene: RenderRoot): Camera => {
  if (scene.camera.kind === "perspective-camera" || scene.camera.kind === "orthographic-camera") {
    return scene.camera;
  }
  throw new Error("Royal direct-surface slice does not yet support camera view resources");
};

const solidUnlitColor = (node: MeshNode): LinearRgba => {
  const material = node.material;
  if (material.kind !== "unlit") {
    throw new Error(`Royal direct-surface slice does not yet support ${material.kind} materials`);
  }
  if (material.baseColor.kind !== "solid") {
    throw new Error("Royal direct-surface slice does not yet support image or virtual textures");
  }
  if (material.baseColor.color[3] !== 1) {
    throw new Error("Royal direct-surface slice does not yet support non-opaque materials");
  }
  return material.baseColor.color;
};

/** Validates and lowers a complete direct scene before any GL resource work. */
export const prepareCanonicalSurfaceScene = (scene: RenderRoot): CanonicalSurfaceScene => {
  const surfaces: CanonicalSurface[] = [];
  for (const node of scene.nodes) {
    if (node.kind !== "mesh") {
      throw new Error(`Royal direct-surface slice does not yet support ${node.kind} nodes`);
    }
    const geometry = prepareCanonicalGeometry(node.geometry);
    const model = transformMat4(node.transform);
    surfaces.push({
      color: solidUnlitColor(node),
      geometry,
      inverseModel: inverseMat4(model),
      model,
      modelHandedness: modelHandedness(model),
      node,
      pickingGeometry: node.pickingGeometry === undefined
        ? geometry
        : prepareCanonicalGeometry(node.pickingGeometry),
    });
  }
  return {
    camera: staticCamera(scene),
    surfaces,
  };
};
