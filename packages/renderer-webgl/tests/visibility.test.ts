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
  unlitMaterial,
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
  cullVisibilityPackets,
  extractFrustumPlanes,
  VisibilityBoundsSource,
  VisibilityPacketKind,
} from "../src/visibility";

const material = unlitMaterial({ baseColor: solidTexture({ color: [1, 0, 0, 1] }) });

const modelAsset = {
  id: "model",
  uri: "https://example.test/model.gltf",
};

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
    const model = gltf({ asset: modelAsset });
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
});
