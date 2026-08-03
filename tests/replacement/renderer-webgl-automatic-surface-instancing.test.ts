import {
  gltf,
  imageTexture,
  perspectiveCamera,
  scene,
  type RenderObjectHandle,
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { prepareStaticGlb } from "../../packages/renderer-webgl/src/gltf/static-asset";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import {
  canonicalMaterialInstanceIdentityKey,
} from "../../packages/renderer-webgl/src/surface/automatic-surface-instancing";
import type { CanonicalSurfaceMaterial } from "../../packages/renderer-webgl/src/surface/canonical-material";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  staticTexturedTriangleGlb,
  staticTriangleDocument,
  staticTriangleGlb,
} from "./support/static-glb";
import { canvasRootHarness } from "./support/canvas-root-harness";
import { waitFor } from "./support/wait-for";

describe("automatic canonical surface instancing", () => {
  it("converges independent opaque glTF roots with exact geometry and material identity", () => {
    const bytes = staticTexturedTriangleGlb(new Uint8Array([1, 2, 3, 4]));
    const leftAsset = prepareStaticGlb(bytes, "left-root");
    const rightAsset = prepareStaticGlb(bytes, "right-root");
    const left = gltf({ src: "/left.glb", transform: { position: [-5, 0, 0] } });
    const right = gltf({ src: "/right.glb", transform: { position: [5, 0, 0] } });
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [left, right] }),
      (node) => node === left ? leftAsset : rightAsset,
      undefined,
      undefined,
      undefined,
      { automaticInstancing: false },
    );

    expect(prepared.surfaces[0]!.geometry.key)
      .not.toBe(prepared.surfaces[1]!.geometry.key);
    expect(canonicalMaterialInstanceIdentityKey(prepared.surfaces[0]!.materialSource))
      .toBe(canonicalMaterialInstanceIdentityKey(prepared.surfaces[1]!.materialSource));
    const converged = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [left, right] }),
      (node) => node === left ? leftAsset : rightAsset,
    );
    expect(converged.surfaces).toHaveLength(1);
    const surface = converged.surfaces[0]!;
    expect(surface.instances?.count).toBe(2);
    expect(surface.model).toEqual(identityMat4());
    expect(surface.normalTransform).toEqual(identityMat4());
    expect(surface.instances?.localModels[12]).toBe(-4);
    expect(surface.instances?.localModels[28]).toBe(6);
    expect(surface.worldBounds).toEqual({ max: [7, 3, 0], min: [-5, 1, 0] });
    expect(converged.pickSurfaces).toHaveLength(2);
    expect(converged.pickSurfaces.map(({ node }) => node)).toEqual([left, right]);
  });

  it("keeps retained instance identity stable while transform revisions stay exact", () => {
    const asset = prepareStaticGlb(staticTriangleGlb(), "shared-root");
    const render = (rightX: number) => {
      const left = gltf({ src: "/left.glb" });
      const right = gltf({ src: "/right.glb", transform: { position: [rightX, 0, 0] } });
      return prepareCanonicalSurfaceScene(
        scene({ camera: perspectiveCamera({}), nodes: [left, right] }),
        () => asset,
      ).surfaces[0]!.instances!;
    };
    const first = render(5);
    const moved = render(6);
    expect(moved.key).toBe(first.key);
    expect(moved.revision).not.toBe(first.revision);
  });

  it("submits converged roots through the existing WebGL instance executor", async () => {
    const { canvas, flushScheduledFrames, root } = canvasRootHarness({
      readGltf: async () => staticTriangleGlb(),
    });
    const left = gltf({ src: "/shared.glb", transform: { position: [-1, 0, 0] } });
    const right = gltf({ src: "/shared.glb", transform: { position: [1, 0, 0] } });
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [left, right],
    }));
    await waitFor(() => expect(root.getGltfAssetSnapshot(left.asset).status).toBe("ready"));
    flushScheduledFrames();

    expect(canvas.gl.drawElements).not.toHaveBeenCalled();
    expect(canvas.gl.drawElementsInstanced).toHaveBeenCalledWith(
      canvas.gl.TRIANGLES,
      3,
      canvas.gl.UNSIGNED_BYTE,
      0,
      2,
    );
    root.dispose();
  });

  it("does not merge distinct materials, blended surfaces, LODs, or imperative refs", () => {
    const blueDocument = staticTriangleDocument();
    const redDocument = staticTriangleDocument();
    const redMaterials = redDocument.materials as Array<Record<string, unknown>>;
    redMaterials[0] = {
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] },
    };
    const blue = prepareStaticGlb(staticTriangleGlb(blueDocument), "blue");
    const red = prepareStaticGlb(staticTriangleGlb(redDocument), "red");
    const left = gltf({ src: "/blue.glb" });
    const right = gltf({ src: "/red.glb" });
    const distinct = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [left, right] }),
      (node) => node === left ? blue : red,
    );
    expect(distinct.surfaces).toHaveLength(2);

    const blendedDocument = staticTriangleDocument();
    const blendedMaterials = blendedDocument.materials as Array<Record<string, unknown>>;
    blendedMaterials[0]!.alphaMode = "BLEND";
    const blended = prepareStaticGlb(staticTriangleGlb(blendedDocument), "blended");
    const blendedScene = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [left, right] }),
      () => blended,
    );
    expect(blendedScene.surfaces).toHaveLength(2);

    const ref: { current: RenderObjectHandle | null } = { current: null };
    const referenced = gltf({ ref, src: "/referenced.glb" });
    const staticNode = gltf({ src: "/static.glb" });
    const refScene = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [referenced, staticNode] }),
      () => blue,
    );
    expect(refScene.surfaces).toHaveLength(2);

    const mirrored = gltf({ src: "/mirrored.glb", transform: { scale: [-1, 1, 1] } });
    const ordinary = gltf({ src: "/ordinary.glb" });
    const mixedHandedness = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes: [mirrored, ordinary] }),
      () => blue,
    );
    expect(mixedHandedness.surfaces).toHaveLength(2);
  });

  it("treats sampler and UV semantics as material identity", () => {
    const material = (
      texture: ReturnType<typeof imageTexture>,
      offset = 0,
    ): CanonicalSurfaceMaterial => ({
      baseColor: [1, 1, 1, 1],
      baseColorAsset: texture,
      baseColorTextureCoordinates: {
        row0: [1, 0, offset, 0],
        row1: [0, 1, 0, 0],
      },
      kind: "unlit",
      requiresTextureCoordinates: true,
    });
    const linear = material(imageTexture("/shared.png"));
    const nearest = material(imageTexture({
      sampler: { minFilter: "nearest" },
      src: "/shared.png",
    }));
    expect(canonicalMaterialInstanceIdentityKey(nearest))
      .not.toBe(canonicalMaterialInstanceIdentityKey(linear));
    expect(canonicalMaterialInstanceIdentityKey(material(imageTexture("/shared.png"), 0.25)))
      .not.toBe(canonicalMaterialInstanceIdentityKey(linear));
  });

  it("supports an explicit internal opt-out for occurrence-sensitive lowering", () => {
    const asset = prepareStaticGlb(staticTriangleGlb(), "shared-root");
    const nodes = [gltf({ src: "/left.glb" }), gltf({ src: "/right.glb" })];
    const prepared = prepareCanonicalSurfaceScene(
      scene({ camera: perspectiveCamera({}), nodes }),
      () => asset,
      undefined,
      undefined,
      undefined,
      { automaticInstancing: false },
    );
    expect(prepared.surfaces).toHaveLength(2);
    expect(prepared.surfaces.every(({ instances }) => instances === undefined)).toBe(true);
  });
});
