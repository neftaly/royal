import { describe, expect, it, vi } from "vitest";

vi.mock("@royal/renderer-core", async () => await import("../../renderer-core/src/index"));

import {
  boxGeometry,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  solidTexture,
  text,
  textureAsset,
  unlitMaterial,
  virtualTextureAsset,
} from "@royal/renderer-core";
import {
  invert,
  multiply,
  orthographic,
  rotation,
  translation,
} from "../src/matrix";
import {
  buildVisibilityPackets,
  createVisibilityCullScratch,
  createVisibilityPacketScratch,
  cullVisibilityPackets,
  extractFrustumPlanes,
  VisibilityBoundsSource,
  VisibilityPacketKind,
} from "../src/visibility";

const material = unlitMaterial({ color: [1, 0, 0, 1] });

const modelAsset = {
  id: "model",
  uri: "https://example.test/model.gltf",
};
const modelSrc = "https://example.test/model.gltf";

const camera = orthographicCamera({
  position: [0, 0, 5],
  rotation: [0, 0, 0],
  left: -2,
  right: 2,
  bottom: -2,
  top: 2,
  near: 0.1,
  far: 20,
});

const viewProjection = () => multiply(
  orthographic(camera.left, camera.right, camera.bottom, camera.top, camera.near, camera.far),
  invert(multiply(translation(camera.position), rotation(camera.rotation))),
);

describe("visibility packets", () => {
  it("extracts box, text, and conservative glTF packets without exposing public API", () => {
    const box = mesh({
      geometry: boxGeometry({ size: [2, 4, 6] }),
      material,
      transform: {
        position: [10, 2, -3],
        rotation: [0, 0, 0],
        scale: [2, 1, 0.5],
      },
    });
    const label = text({
      color: [1, 1, 1, 1],
      origin: [-1, 1, 0.25],
      text: "a",
    });
    const model = gltf({ src: modelSrc });
    const packets = buildVisibilityPackets(pass({
      camera,
      children: [box, label, model],
    }));

    expect(packets.count).toBe(3);
    expect(Array.from(packets.nodeIndices)).toEqual([0, 1, 2]);
    expect(Array.from(packets.kinds)).toEqual([
      VisibilityPacketKind.Mesh,
      VisibilityPacketKind.VectorText,
      VisibilityPacketKind.Gltf,
    ]);
    expect(Array.from(packets.boundsSources)).toEqual([
      VisibilityBoundsSource.BoxMesh,
      VisibilityBoundsSource.TextLayout,
      VisibilityBoundsSource.GltfConservative,
    ]);

    expect(packets.centerX[0]).toBeCloseTo(10);
    expect(packets.centerY[0]).toBeCloseTo(2);
    expect(packets.centerZ[0]).toBeCloseTo(-3);
    expect(packets.minX[0]).toBeCloseTo(8);
    expect(packets.maxX[0]).toBeCloseTo(12);
    expect(packets.minY[0]).toBeCloseTo(0);
    expect(packets.maxY[0]).toBeCloseTo(4);
    expect(packets.minZ[0]).toBeCloseTo(-4.5);
    expect(packets.maxZ[0]).toBeCloseTo(-1.5);
    expect(packets.radius[0]).toBeCloseTo(Math.hypot(2, 2, 1.5));

    expect(packets.minX[1]).toBeCloseTo(label.layout.bounds.xMin);
    expect(packets.maxX[1]).toBeCloseTo(label.layout.bounds.xMax);
    expect(packets.minY[1]).toBeCloseTo(label.layout.bounds.yMin);
    expect(packets.maxY[1]).toBeCloseTo(label.layout.bounds.yMax);
    expect(packets.minZ[1]).toBeCloseTo(0.25);
    expect(packets.maxZ[1]).toBeCloseTo(0.25);

    expect(packets.radius[2]).toBe(Number.POSITIVE_INFINITY);
  });

  it("culls bounded packets against camera frustum planes", () => {
    const visibleBox = mesh({
      geometry: boxGeometry({ size: [1, 1, 1] }),
      material,
    });
    const offscreenBox = mesh({
      geometry: boxGeometry({ size: [1, 1, 1] }),
      material,
      transform: {
        position: [20, 0, 0],
        rotation: [0, 0, 0],
      },
    });
    const packets = buildVisibilityPackets(pass({
      camera,
      children: [visibleBox, offscreenBox],
    }));
    const result = cullVisibilityPackets(packets, extractFrustumPlanes(viewProjection()));

    expect(Array.from(result.visibleIndices)).toEqual([0]);
    expect(result.stats.packetCount).toBe(2);
    expect(result.stats.visibleCount).toBe(1);
    expect(result.stats.culledCount).toBe(1);
    expect(result.stats.cullMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps conservative glTF packets visible until asset bounds exist", () => {
    const packets = buildVisibilityPackets(pass({
      camera,
      children: [
        gltf({
          asset: modelAsset,
          transform: {
            position: [1000, 0, 0],
            rotation: [0, 0, 0],
          },
        }),
      ],
    }));
    const result = cullVisibilityPackets(packets, extractFrustumPlanes(viewProjection()));

    expect(Array.from(result.visibleIndices)).toEqual([0]);
    expect(result.stats.culledCount).toBe(0);
  });

  it("culls glTF packets when private asset bounds are available", () => {
    const model = gltf({
      asset: modelAsset,
      transform: {
        position: [1000, 0, 0],
        rotation: [0, 0, 0],
      },
    });
    const packets = buildVisibilityPackets(pass({
      camera,
      children: [model],
    }), {
      gltfBounds: () => ({
        maxX: 1000.5,
        maxY: 0.5,
        maxZ: 0.5,
        minX: 999.5,
        minY: -0.5,
        minZ: -0.5,
      }),
    });
    const result = cullVisibilityPackets(packets, extractFrustumPlanes(viewProjection()));

    expect(packets.boundsSources[0]).toBe(VisibilityBoundsSource.GltfAsset);
    expect(Array.from(result.visibleIndices)).toEqual([]);
    expect(result.stats.culledCount).toBe(1);
  });

  it("reuses packet and cull scratch buffers without changing visible results", () => {
    const packetScratch = createVisibilityPacketScratch(4);
    const cullScratch = createVisibilityCullScratch(4);
    const visibleBox = mesh({
      geometry: boxGeometry({ size: [1, 1, 1] }),
      material,
    });
    const offscreenBox = mesh({
      geometry: boxGeometry({ size: [1, 1, 1] }),
      material,
      transform: {
        position: [20, 0, 0],
        rotation: [0, 0, 0],
      },
    });

    const first = buildVisibilityPackets(pass({
      camera,
      children: [visibleBox, offscreenBox],
    }), { packetScratch });
    const result = cullVisibilityPackets(first, extractFrustumPlanes(viewProjection()), {
      scratch: cullScratch,
    });
    const second = buildVisibilityPackets(pass({
      camera,
      children: [visibleBox],
    }), { packetScratch });

    expect(first.nodeIndices).toBe(packetScratch.nodeIndices);
    expect(first.capacity).toBe(4);
    expect(Array.from(result.visibleIndices)).toEqual([0]);
    expect(result.visibleIndices.buffer).toBe(cullScratch.visibleIndices.buffer);
    expect(second.nodeIndices).toBe(packetScratch.nodeIndices);
    expect(second.count).toBe(1);
    expect(second.extractionVersion).toBeGreaterThan(first.extractionVersion);
  });

  it("tracks stable object, material, asset, and version lanes for future LOD decisions", () => {
    const baseTexture = solidTexture({
      color: [0.1, 0.2, 0.3, 1],
      id: "matte-red",
      revision: 1,
    });
    const updatedTexture = solidTexture({
      color: [0.1, 0.2, 0.3, 1],
      id: "matte-red",
      revision: 2,
    });
    const sharedMaterial = unlitMaterial({ texture: baseTexture });
    const box = mesh({
      geometry: boxGeometry({ size: [1, 1, 1] }),
      material: sharedMaterial,
    });
    const sameObjectAgain = buildVisibilityPackets(pass({
      camera,
      children: [box],
    }));
    const sameObjectThird = buildVisibilityPackets(pass({
      camera,
      children: [box],
    }));
    const materialRevision = buildVisibilityPackets(pass({
      camera,
      children: [
        mesh({
          geometry: boxGeometry({ size: [1, 1, 1] }),
          material: unlitMaterial({ texture: updatedTexture }),
        }),
      ],
    }));
    const model = gltf({
      asset: {
        id: "ship",
        revision: "r1",
        uri: "https://example.test/ship.gltf",
      },
    });
    const modelPacket = buildVisibilityPackets(pass({
      camera,
      children: [model],
    }));

    expect(sameObjectAgain.objectIdHi[0]).toBe(sameObjectThird.objectIdHi[0]);
    expect(sameObjectAgain.objectIdLo[0]).toBe(sameObjectThird.objectIdLo[0]);
    expect(sameObjectAgain.objectVersions[0]).toBe(sameObjectThird.objectVersions[0]);
    expect(sameObjectAgain.materialIdHi[0]).toBe(materialRevision.materialIdHi[0]);
    expect(sameObjectAgain.materialIdLo[0]).toBe(materialRevision.materialIdLo[0]);
    expect(sameObjectAgain.materialVersions[0]).not.toBe(materialRevision.materialVersions[0]);
    expect(sameObjectAgain.assetIdHi[0]).toBe(0);
    expect(sameObjectAgain.assetIdLo[0]).toBe(0);
    expect(modelPacket.assetIdHi[0]).not.toBe(0);
    expect(modelPacket.assetIdLo[0]).not.toBe(0);
    expect(modelPacket.assetVersions[0]).not.toBe(0);
  });

  it("tracks virtual texture assets by manifest identity and fallback color without requiring a uri", () => {
    const fallback = solidTexture({ color: [0.2, 0.3, 0.4, 1] });
    const changedFallback = solidTexture({ color: [0.4, 0.3, 0.2, 1] });
    const preview = textureAsset({
      fallback: solidTexture({ color: [0.1, 0.2, 0.3, 1] }),
      id: "terrain-preview",
      uri: "https://example.test/terrain-preview.png",
    });
    const virtualMaterial = unlitMaterial({
      texture: virtualTextureAsset({
        fallback,
        id: "terrain-vt",
        manifestId: "terrain-manifest",
        manifestUri: "https://example.test/terrain.vt.json",
      }),
    });
    const fallbackRevision = unlitMaterial({
      texture: virtualTextureAsset({
        fallback: changedFallback,
        id: "terrain-vt",
        manifestId: "terrain-manifest",
        manifestUri: "https://example.test/terrain.vt.json",
      }),
    });
    const manifestRevision = unlitMaterial({
      texture: virtualTextureAsset({
        fallback,
        id: "terrain-vt",
        manifestId: "terrain-manifest",
        manifestUri: "https://example.test/terrain-v2.vt.json",
      }),
    });
    const previewMaterial = unlitMaterial({
      texture: virtualTextureAsset({
        fallback,
        id: "terrain-vt",
        manifestId: "terrain-manifest",
        manifestUri: "https://example.test/terrain.vt.json",
        preview,
      }),
    });
    const previewRevision = unlitMaterial({
      texture: virtualTextureAsset({
        fallback,
        id: "terrain-vt",
        manifestId: "terrain-manifest",
        manifestUri: "https://example.test/terrain.vt.json",
        preview: textureAsset({
          ...preview,
          revision: "preview-v2",
        }),
      }),
    });

    const basePacket = buildVisibilityPackets(pass({
      camera,
      children: [mesh({ geometry: boxGeometry({ size: [1, 1, 1] }), material: virtualMaterial })],
    }));
    const fallbackPacket = buildVisibilityPackets(pass({
      camera,
      children: [mesh({ geometry: boxGeometry({ size: [1, 1, 1] }), material: fallbackRevision })],
    }));
    const manifestPacket = buildVisibilityPackets(pass({
      camera,
      children: [mesh({ geometry: boxGeometry({ size: [1, 1, 1] }), material: manifestRevision })],
    }));
    const previewPacket = buildVisibilityPackets(pass({
      camera,
      children: [mesh({ geometry: boxGeometry({ size: [1, 1, 1] }), material: previewMaterial })],
    }));
    const previewRevisionPacket = buildVisibilityPackets(pass({
      camera,
      children: [mesh({ geometry: boxGeometry({ size: [1, 1, 1] }), material: previewRevision })],
    }));

    expect(basePacket.assetIdHi[0]).not.toBe(0);
    expect(basePacket.assetIdLo[0]).not.toBe(0);
    expect(basePacket.assetVersions[0]).not.toBe(0);
    expect(fallbackPacket.assetIdHi[0]).toBe(basePacket.assetIdHi[0]);
    expect(fallbackPacket.assetIdLo[0]).toBe(basePacket.assetIdLo[0]);
    expect(fallbackPacket.assetVersions[0]).not.toBe(basePacket.assetVersions[0]);
    expect(fallbackPacket.materialVersions[0]).not.toBe(basePacket.materialVersions[0]);
    expect(manifestPacket.assetIdLo[0]).not.toBe(basePacket.assetIdLo[0]);
    expect(previewPacket.assetIdLo[0]).not.toBe(basePacket.assetIdLo[0]);
    expect(previewRevisionPacket.assetIdHi[0]).toBe(previewPacket.assetIdHi[0]);
    expect(previewRevisionPacket.assetIdLo[0]).toBe(previewPacket.assetIdLo[0]);
    expect(previewRevisionPacket.assetVersions[0]).not.toBe(previewPacket.assetVersions[0]);
  });
});
