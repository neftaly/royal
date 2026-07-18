import type {
  Camera,
  GltfNode,
  LinearRgba,
  MeshNode,
  RenderRoot,
} from "@royal/renderer-core";
import {
  identityMat4,
  inverseMat4,
  multiplyMat4Into,
  transformMat4,
  type Mat4,
} from "../math/mat4";
import type { PreparedStaticGltf } from "../gltf/static-asset";
import {
  prepareCanonicalGeometry,
  type CanonicalTriangleGeometry,
} from "./canonical-geometry";

export type CanonicalDrawSurface = Readonly<{
  color: LinearRgba;
  geometry: CanonicalTriangleGeometry;
  model: Mat4;
  node: MeshNode | GltfNode;
}>;

export type CanonicalPickSurface = Readonly<{
  inverseModel: Mat4 | undefined;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode;
  pickingGeometry: CanonicalTriangleGeometry;
}>;

export type CanonicalSurfaceScene = Readonly<{
  camera: Camera;
  pickSurfaces: readonly CanonicalPickSurface[];
  surfaces: readonly CanonicalDrawSurface[];
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
export const prepareCanonicalSurfaceScene = (
  scene: RenderRoot,
  preparedGltf: (node: GltfNode) => PreparedStaticGltf | undefined = () => undefined,
): CanonicalSurfaceScene => {
  const pickSurfaces: CanonicalPickSurface[] = [];
  const surfaces: CanonicalDrawSurface[] = [];
  for (const node of scene.nodes) {
    if (node.kind === "gltf") {
      if (node.materialVariant !== undefined) {
        throw new Error("Royal static glTF slice does not yet support materialVariant");
      }
      const rootModel = transformMat4(node.transform);
      const proxyGeometry = node.pickingGeometry === undefined
        ? undefined
        : prepareCanonicalGeometry(node.pickingGeometry);
      if (proxyGeometry !== undefined) {
        pickSurfaces.push({
          inverseModel: inverseMat4(rootModel),
          modelHandedness: modelHandedness(rootModel),
          node,
          pickingGeometry: proxyGeometry,
        });
      }
      const prepared = preparedGltf(node);
      if (prepared === undefined) continue;
      for (const primitive of prepared.primitives) {
        const model = multiplyMat4Into(identityMat4(), rootModel, primitive.localModel);
        const surface: CanonicalDrawSurface = {
          color: primitive.color,
          geometry: primitive.geometry,
          model,
          node,
        };
        if (proxyGeometry === undefined) {
          const pickableSurface = {
            ...surface,
            inverseModel: inverseMat4(model),
            modelHandedness: modelHandedness(model),
            pickingGeometry: primitive.geometry,
          };
          surfaces.push(pickableSurface);
          pickSurfaces.push(pickableSurface);
        } else {
          surfaces.push(surface);
        }
      }
      continue;
    }
    if (node.kind !== "mesh") {
      throw new Error(`Royal direct-surface slice does not yet support ${node.kind} nodes`);
    }
    const geometry = prepareCanonicalGeometry(node.geometry);
    const model = transformMat4(node.transform);
    const surface = {
      color: solidUnlitColor(node),
      geometry,
      inverseModel: inverseMat4(model),
      model,
      modelHandedness: modelHandedness(model),
      node,
      pickingGeometry: node.pickingGeometry === undefined
        ? geometry
        : prepareCanonicalGeometry(node.pickingGeometry),
    };
    surfaces.push(surface);
    pickSurfaces.push(surface);
  }
  return {
    camera: staticCamera(scene),
    pickSurfaces,
    surfaces,
  };
};
