import { describe, expect, it } from "vitest";
import {
  gltfLoadDiagnosticsSnapshot,
  type GltfLoadDiagnosticsState,
} from "../packages/renderer-webgl/src/gltf/load-diagnostics";

const state = (
  sourceUri: string,
  status: GltfLoadDiagnosticsState["status"],
  overrides: Partial<GltfLoadDiagnosticsState> = {},
): GltfLoadDiagnosticsState => ({
  lightCount: 0,
  load: {
    buffersLoadedAt: 30,
    documentLoadedAt: 20,
    dracoDecodedAt: 45,
    firstImageSettledAt: 80,
    imageFailures: 1,
    imageLoaded: 2,
    imageLoadStartedAt: 60,
    imageRequests: 3,
    imagesSettledAt: 100,
    meshoptDecodedAt: 40,
    readyAt: 55,
    sceneReadAt: 50,
    startedAt: 10,
  },
  nodeCount: 4,
  primitiveCount: 5,
  sourceUri,
  status,
  variants: ["ruby", "mint"],
  ...overrides,
});

describe("glTF load diagnostics core", () => {
  it("projects phase durations and public ready status without mutating input", () => {
    const input = state("model.glb", "ready", { sourceVersion: "revision-a" });

    expect(gltfLoadDiagnosticsSnapshot([input])).toEqual({
      assets: [{
        imageFailures: 1,
        imagesLoaded: 2,
        imageRequests: 3,
        lightCount: 0,
        nodeCount: 4,
        phaseMs: {
          buffers: 10,
          document: 10,
          draco: 5,
          firstImageComplete: 20,
          imagesComplete: 40,
          meshopt: 10,
          scene: 5,
          toSceneReady: 45,
        },
        primitiveCount: 5,
        uri: "model.glb",
        version: "revision-a",
        status: "sceneReady",
        variantNames: ["ruby", "mint"],
      }],
    });
    expect(input.status).toBe("ready");
    expect(Object.isFrozen(gltfLoadDiagnosticsSnapshot([input]).assets[0]?.variantNames)).toBe(true);
  });

  it("preserves each status and omits unavailable phases", () => {
    const loading = state("loading.glb", "loading", {
      load: { imageFailures: 0, imageLoaded: 0, imageRequests: 0, startedAt: 20 },
    });
    const error = state("broken.glb", "error", {
      error: "decode failed",
      load: {
        documentLoadedAt: 10,
        imageFailures: 0,
        imageLoaded: 0,
        imageRequests: 0,
        startedAt: 20,
      },
    });

    const snapshot = gltfLoadDiagnosticsSnapshot([loading, error]);

    expect(snapshot.assets.map((asset) => asset.status)).toEqual(["loading", "error"]);
    expect(snapshot.assets[0]?.phaseMs).toEqual({});
    expect(snapshot.assets[1]).toMatchObject({
      error: "decode failed",
      phaseMs: { document: 0 },
      status: "error",
    });
  });
});
