import { gltf } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { GltfAssetOwner } from "../../packages/renderer-webgl/src/gltf/asset-owner";
import {
  prepareStaticGlb,
  prepareStaticGltfSource,
} from "../../packages/renderer-webgl/src/gltf/static-asset";
import {
  planStaticGltfGeometryTasks,
  type StaticGeometryTaskPlan,
} from "../../packages/renderer-webgl/src/gltf/static-geometry-plan";
import type { JsonObject } from "../../packages/renderer-webgl/src/gltf/gltf-values";
import { staticTriangleDocument, staticTriangleGlb } from "./support/static-glb";
import { waitFor } from "./support/wait-for";

const encodedFixture = async (
  quantized: boolean,
  markFallback = true,
  fallbackFirst = false,
): Promise<Readonly<{
  compressed: Uint8Array;
  document: Uint8Array;
}>> => {
  const decodeBase64 = (value: string): Uint8Array => Uint8Array.from(
    atob(value),
    (character) => character.charCodeAt(0),
  );
  const stride = quantized ? 8 : 12;
  const positions = new Uint8Array(stride * 3);
  if (quantized) {
    const values = new Int16Array(positions.buffer);
    values.set([
      -32_767, -32_767, 0, 0,
      32_767, -32_767, 0, 0,
      0, 32_767, 0, 0,
    ]);
  } else {
    new Float32Array(positions.buffer).set([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0,
    ]);
  }
  const indices = new Uint8Array(6);
  new Uint16Array(indices.buffer).set([0, 1, 2]);
  // Stable EXT v0 streams produced by meshoptimizer 1.2.0. Keeping the bytes
  // literal ensures this is a decoder/conformance test, not an encoder echo.
  const encodedPositions = decodeBase64(quantized
    ? "oAE4AAAAAwEcAAAA/QEMAAAAAwEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAYAAAAAA"
    : "oAAAAQwAAAD/ATwAAAD/fQAAAAEMAAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgL8AAIC/AAAAAA==");
  const encodedIndices = decodeBase64("4fAAdodWZ3iphmWJaJgBaQAA");
  const compressed = new Uint8Array(encodedPositions.byteLength + encodedIndices.byteLength);
  compressed.set(encodedPositions);
  compressed.set(encodedIndices, encodedPositions.byteLength);
  const extensions = [
    "KHR_materials_unlit",
    "EXT_meshopt_compression",
    ...(quantized ? ["KHR_mesh_quantization"] : []),
  ];
  const compressedBuffer = { byteLength: compressed.byteLength, uri: "triangle.meshopt.bin" };
  const fallbackBuffer = {
    byteLength: positions.byteLength + indices.byteLength,
    ...(markFallback
      ? { extensions: { EXT_meshopt_compression: { fallback: true } } }
      : {}),
  };
  const sourceBuffer = fallbackFirst ? 1 : 0;
  const targetBuffer = fallbackFirst ? 0 : 1;
  const document = {
    accessors: [
      {
        bufferView: 0,
        componentType: quantized ? 5122 : 5126,
        count: 3,
        ...(quantized ? { normalized: true } : {}),
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    asset: { version: "2.0" },
    buffers: fallbackFirst
      ? [fallbackBuffer, compressedBuffer]
      : [compressedBuffer, fallbackBuffer],
    bufferViews: [
      {
        buffer: targetBuffer,
        byteLength: positions.byteLength,
        byteStride: stride,
        extensions: {
          EXT_meshopt_compression: {
            buffer: sourceBuffer,
            byteLength: encodedPositions.byteLength,
            byteStride: stride,
            count: 3,
            mode: "ATTRIBUTES",
          },
        },
      },
      {
        buffer: targetBuffer,
        byteLength: indices.byteLength,
        byteOffset: positions.byteLength,
        extensions: {
          EXT_meshopt_compression: {
            buffer: sourceBuffer,
            byteLength: encodedIndices.byteLength,
            byteOffset: encodedPositions.byteLength,
            byteStride: 2,
            count: 3,
            mode: "TRIANGLES",
          },
        },
      },
    ],
    extensionsRequired: extensions,
    extensionsUsed: extensions,
    materials: [{ extensions: { KHR_materials_unlit: {} } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  return {
    compressed,
    document: new TextEncoder().encode(JSON.stringify(document)),
  };
};

describe("EXT_meshopt_compression ingestion", () => {
  it("plans shared geometry from compressed authority while retaining derived fallback layout", async () => {
    const marked = await encodedFixture(false);
    const markedDocument = JSON.parse(
      new TextDecoder().decode(marked.document),
    ) as JsonObject;
    const variantDocument = structuredClone(markedDocument);
    variantDocument.materials = [{
      extensions: { KHR_materials_unlit: {} },
      name: "unrelated variant material",
    }];
    const markedPlan = planStaticGltfGeometryTasks(
      markedDocument,
      "meshopt-marked-plan",
      "/models/red.gltf",
    );
    const variantPlan = planStaticGltfGeometryTasks(
      variantDocument,
      "meshopt-variant-plan",
      "/models/blue.gltf",
    );

    expect(markedPlan?.tasks).toHaveLength(1);
    expect(variantPlan?.tasks[0]!.key).toBe(markedPlan?.tasks[0]!.key);

    const implicit = await encodedFixture(false, false);
    const implicitDocument = JSON.parse(
      new TextDecoder().decode(implicit.document),
    ) as JsonObject;
    expect(planStaticGltfGeometryTasks(
      implicitDocument,
      "meshopt-implicit-plan",
      "/models/implicit.gltf",
    )?.tasks).toHaveLength(1);

    implicitDocument.extensionsRequired = ["KHR_materials_unlit"];
    expect(planStaticGltfGeometryTasks(
      implicitDocument,
      "meshopt-optional-placeholder",
      "/models/optional.gltf",
    )).toBeUndefined();

    const unexplained = structuredClone(markedDocument);
    delete (unexplained.buffers as JsonObject[])[1]!.extensions;
    delete (unexplained.bufferViews as JsonObject[])[0]!.extensions;
    delete (unexplained.bufferViews as JsonObject[])[1]!.extensions;
    expect(planStaticGltfGeometryTasks(
      unexplained,
      "unexplained-uri-less-buffer",
      "/models/unexplained.gltf",
    )).toBeUndefined();
  });

  it("prepares repeated meshopt roots once without reading derived fallback buffers", async () => {
    const fixture = await encodedFixture(false);
    const readResource = vi.fn(async () => fixture.compressed);
    const owner = new GltfAssetOwner({
      onAssetChanged: vi.fn(),
      onListenerError: vi.fn(),
      prepare: (
        bytes,
        contentKey,
        label,
        sourceUri,
        _signal,
        read,
        sceneIndex,
        resourceVersion,
        geometryTasks?: StaticGeometryTaskPlan,
        computeGeometryTaskKeys?: ReadonlySet<string>,
      ) => prepareStaticGltfSource(
        bytes,
        contentKey,
        label,
        sourceUri,
        read,
        undefined,
        sceneIndex,
        resourceVersion,
        geometryTasks,
        computeGeometryTaskKeys,
      ),
      read: async () => fixture.document,
      readResource,
      sharedGeometryPreparation: true,
    });
    const first = gltf("/models/red.gltf");
    const second = gltf("/models/blue.gltf");

    owner.reconcile([first, second]);
    await waitFor(() => expect(owner.getSnapshot(first.asset).status).toBe("ready"));
    await waitFor(() => expect(owner.getSnapshot(second.asset).status).toBe("ready"));

    expect(readResource).toHaveBeenCalledOnce();
    expect(owner.sharedGeometrySnapshot()).toMatchObject({
      preparationTaskClaims: 2,
      preparedTasks: 1,
      reusedClaims: 1,
      reusedPreparationClaims: 1,
      uniqueGeometries: 1,
    });
    owner.dispose();
  });

  it("decodes demanded attribute and triangle views without reading the fallback buffer", async () => {
    const fixture = await encodedFixture(false);
    const read = vi.fn(async (uri: string) => {
      expect(uri).toBe("/models/triangle.meshopt.bin");
      return fixture.compressed;
    });
    const prepared = await prepareStaticGltfSource(
      fixture.document,
      "meshopt",
      "meshopt.gltf",
      "/models/meshopt.gltf",
      read,
    );

    expect(read).toHaveBeenCalledOnce();
    expect(prepared.primitives[0]!.geometry.positions).toEqual(new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0,
    ]));
    expect(prepared.primitives[0]!.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
  });

  it("lowers ordinary quantized meshopt output through the same canonical geometry path", async () => {
    const fixture = await encodedFixture(true);
    const prepared = await prepareStaticGltfSource(
      fixture.document,
      "meshopt-quantized",
      "meshopt-quantized.gltf",
      "/models/meshopt-quantized.gltf",
      async () => fixture.compressed,
    );

    expect(prepared.primitives[0]!.geometry.positions).toEqual(new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      0, 1, 0,
    ]));
  });

  it("accepts the standard implicit URI-less fallback form", async () => {
    const fixture = await encodedFixture(false, false);
    const read = vi.fn(async () => fixture.compressed);
    const prepared = await prepareStaticGltfSource(
      fixture.document,
      "meshopt-implicit-fallback",
      "meshopt-implicit-fallback.gltf",
      "/models/meshopt-implicit-fallback.gltf",
      read,
    );
    expect(read).toHaveBeenCalledOnce();
    expect(prepared.primitives[0]!.geometry.indices).toEqual(new Uint16Array([0, 1, 2]));
  });

  it("canonicalizes a fallback-first multi-buffer document", async () => {
    const fixture = await encodedFixture(false, true, true);
    const prepared = await prepareStaticGltfSource(
      fixture.document,
      "meshopt-fallback-first",
      "meshopt-fallback-first.gltf",
      "/models/meshopt-fallback-first.gltf",
      async () => fixture.compressed,
    );
    expect(prepared.primitives[0]!.geometry.positions[0]).toBe(-1);
  });

  it("fails declarations and malformed fallback graphs before resource or codec work", async () => {
    const fixture = await encodedFixture(false);
    const invalidVersion = JSON.parse(new TextDecoder().decode(fixture.document)) as {
      asset: { version: string };
    };
    invalidVersion.asset.version = "1.0";
    const read = vi.fn(async () => fixture.compressed);
    await expect(prepareStaticGltfSource(
      new TextEncoder().encode(JSON.stringify(invalidVersion)),
      "meshopt-invalid-version",
      "meshopt-invalid-version.gltf",
      "/models/meshopt-invalid-version.gltf",
      read,
    )).rejects.toThrow("asset.version: must be 2.0");
    expect(read).not.toHaveBeenCalled();

    const invalidFallback = JSON.parse(new TextDecoder().decode(fixture.document)) as {
      bufferViews: Array<Record<string, unknown>>;
    };
    invalidFallback.bufferViews.push({ buffer: 1, byteLength: 4 });
    await expect(prepareStaticGltfSource(
      new TextEncoder().encode(JSON.stringify(invalidFallback)),
      "meshopt-invalid-fallback",
      "meshopt-invalid-fallback.gltf",
      "/models/meshopt-invalid-fallback.gltf",
      read,
    )).rejects.toThrow("fallback buffers may only be referenced by meshopt bufferViews");
    expect(read).not.toHaveBeenCalled();
  });

  it("requires the quantization declaration before resource or codec work", async () => {
    const fixture = await encodedFixture(true);
    const document = JSON.parse(new TextDecoder().decode(fixture.document)) as {
      extensionsRequired: string[];
    };
    document.extensionsRequired = document.extensionsRequired.filter(
      (name) => name !== "KHR_mesh_quantization",
    );
    const read = vi.fn(async () => fixture.compressed);
    await expect(prepareStaticGltfSource(
      new TextEncoder().encode(JSON.stringify(document)),
      "meshopt-missing-quantization-requirement",
      "meshopt-missing-quantization-requirement.gltf",
      "/models/meshopt-missing-quantization-requirement.gltf",
      read,
    )).rejects.toThrow(
      'extensionsRequired: must include "KHR_mesh_quantization" when that extension is used',
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects required meshopt on the deliberately synchronous GLB helper", () => {
    const document = staticTriangleDocument();
    document.extensionsRequired = ["KHR_materials_unlit", "EXT_meshopt_compression"];
    document.extensionsUsed = ["KHR_materials_unlit", "EXT_meshopt_compression"];
    expect(() => prepareStaticGlb(staticTriangleGlb(document), "sync-meshopt"))
      .toThrow('extensionsRequired[1]: is unsupported ("EXT_meshopt_compression")');
  });
});
