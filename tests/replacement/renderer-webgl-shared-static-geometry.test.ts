import { describe, expect, it } from "vitest";
import type { CanonicalTriangleGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type {
  PreparedStaticGltf,
  PreparedStaticGltfPrimitive,
} from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  sameCanonicalGeometry,
  SharedStaticGeometryOwner,
} from "../../packages/renderer-webgl/src/gltf/shared-geometry-owner";

const geometry = (
  key: string,
  sourceKey: string | undefined,
  x = 1,
): CanonicalTriangleGeometry => ({
  bounds: { max: [x, 1, 0], min: [0, 0, 0] },
  indices: new Uint16Array([0, 1, 2]),
  key,
  positions: new Float32Array([0, 0, 0, x, 0, 0, 0, 1, 0]),
  ...(sourceKey === undefined ? {} : { sourceKey }),
});

const prepared = (value: CanonicalTriangleGeometry): PreparedStaticGltf => ({
  alphaMaskTextureAssets: [],
  bounds: value.bounds,
  lights: [],
  nodeCount: 1,
  primitives: [{
    geometry: value,
    localModel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    material: {
      baseColor: [1, 1, 1, 1],
      kind: "unlit",
      requiresTextureCoordinates: false,
    },
  } satisfies PreparedStaticGltfPrimitive],
  sceneIndex: 0,
  scenes: [{ index: 0 }],
  textureAssets: [],
  variantNames: [],
});

describe("shared static geometry owner", () => {
  it("interns byte-exact source candidates and accounts one retained geometry", () => {
    const owner = new SharedStaticGeometryOwner();
    const first = owner.intern(prepared(geometry("root-a", "shared")));
    const second = owner.intern(prepared(geometry("root-b", "shared")));

    expect(second.primitives[0]!.geometry).toBe(first.primitives[0]!.geometry);
    owner.reconcile([first, second]);
    expect(owner.snapshot()).toEqual({
      primitiveClaims: 2,
      retainedBytes: 42,
      reusedClaims: 1,
      uniqueGeometries: 1,
    });
  });

  it("uses source identity only to narrow candidates and proves exact bytes", () => {
    const owner = new SharedStaticGeometryOwner();
    const first = owner.intern(prepared(geometry("root-a", "candidate", 1)));
    const changed = owner.intern(prepared(geometry("root-b", "candidate", 2)));
    const unowned = owner.intern(prepared(geometry("root-c", undefined, 1)));

    expect(changed.primitives[0]!.geometry).not.toBe(first.primitives[0]!.geometry);
    expect(unowned.primitives[0]!.geometry).not.toBe(first.primitives[0]!.geometry);
    expect(sameCanonicalGeometry(
      first.primitives[0]!.geometry,
      { ...first.primitives[0]!.geometry, indices: new Uint32Array([0, 1, 2]) },
    )).toBe(false);
  });
});
