import {
  type BoxGeometry,
  type DirectionalLightNode,
  type Material,
  type MeshNode,
  type RenderPass,
} from "@royal/renderer-core";

export const findDirectionalLight = (
  pass: RenderPass,
): DirectionalLightNode | undefined =>
  pass.children.find((node) => node.kind === "directional-light");

export const asBoxGeometry = (mesh: MeshNode): BoxGeometry => {
  if (mesh.geometry.kind !== "box") {
    throw new Error(
      `Unsupported mesh geometry kind: ${String(mesh.geometry.kind)}`,
    );
  }

  return mesh.geometry as BoxGeometry;
};

export const asMaterial = (mesh: MeshNode): Material => mesh.material;
