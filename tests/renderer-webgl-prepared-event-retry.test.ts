import { afterEach, describe, expect, it, vi } from "vitest";

const vertexInputFault = vi.hoisted(() => ({
  afterRetainFailure: undefined as Error | undefined,
  arena: undefined as unknown,
  beforeRetain: undefined as (() => void) | undefined,
  retainFailure: undefined as Error | undefined,
  retainCalls: 0,
}));

vi.mock("../packages/renderer-webgl/src/vertex-input-arena", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../packages/renderer-webgl/src/vertex-input-arena")
  >();
  return {
    ...actual,
    retainVertexInputGeometry: (
      ...args: Parameters<typeof actual.retainVertexInputGeometry>
    ): ReturnType<typeof actual.retainVertexInputGeometry> => {
      vertexInputFault.arena = args[0];
      vertexInputFault.retainCalls += 1;
      vertexInputFault.beforeRetain?.();
      const failure = vertexInputFault.retainFailure;
      vertexInputFault.retainFailure = undefined;
      if (failure !== undefined) throw failure;
      const result = actual.retainVertexInputGeometry(...args);
      if (vertexInputFault.afterRetainFailure !== undefined) {
        throw vertexInputFault.afterRetainFailure;
      }
      return result;
    },
  };
});

import { gltf } from "@royal/renderer-core";
import { createWebGlRoot as createWebGlRootBase } from "@royal/renderer-webgl";
import { GltfImageDemandCoordinator } from "../packages/renderer-webgl/src/gltf/image-demand-coordinator";
import { PreparedGltfAssetStore } from "../packages/renderer-webgl/src/gltf/prepared-asset";
import {
  vertexInputArenaSnapshot,
  type VertexInputArena,
} from "../packages/renderer-webgl/src/vertex-input-arena";
import { triangleBin } from "./renderer-webgl-scene-gltf-binary-fixtures";
import {
  solidTriangleDocument,
  triangleDocument,
} from "./renderer-webgl-scene-gltf-material-documents";
import {
  installStagedGltfLoader,
  responseWithBuffer,
  responseWithJson,
} from "./renderer-webgl-scene-gltf-loader-fixtures";
import {
  drawCalls,
  fakeCanvas,
  fakeGl,
  flushMicrotasks,
  flushPreparedAssetBoundary,
  installViewportInvalidationStubs,
  renderScene,
  resetGltfSceneTestState,
  trackGltfSceneTestRoot,
  triangleBinByteLength,
  triangleGltfSrc,
} from "./renderer-webgl-scene-gltf-test-runtime";

const createWebGlRoot = (...args: Parameters<typeof createWebGlRootBase>) =>
  trackGltfSceneTestRoot(createWebGlRootBase(...args));

describe("WebGL prepared-asset event retries", () => {
  afterEach(() => {
    vertexInputFault.afterRetainFailure = undefined;
    vertexInputFault.arena = undefined;
    vertexInputFault.beforeRetain = undefined;
    vertexInputFault.retainFailure = undefined;
    vertexInputFault.retainCalls = 0;
    resetGltfSceneTestState();
  });

  it("publishes a retained replacement event after its resource side effects retry", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "retained-prepared-event" }),
    ]);
    const originalDocument = solidTriangleDocument();
    originalDocument.buffers = [{
      byteLength: triangleBinByteLength,
      uri: "original-prepared-event.bin",
    }];
    const replacementDocument = solidTriangleDocument();
    replacementDocument.buffers = [{
      byteLength: triangleBinByteLength,
      uri: "retained-prepared-event.bin",
    }];
    replacementDocument.meshes[0]!.primitives[0]!.mode = 1;

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, originalDocument))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/original-prepared-event\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushPreparedAssetBoundary();
    expect(drawCalls(calls)).toHaveLength(1);
    expect(drawCalls(calls)[0]?.args[0]).toBe(gl.TRIANGLES);

    root.render(renderScene([]));
    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, replacementDocument))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/retained-prepared-event\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const failure = new Error("prepared geometry retain failed");
    vertexInputFault.retainFailure = failure;
    const drawsBeforeReplacement = drawCalls(calls).length;
    expect(() => root.flushInvalidated()).toThrow(failure);
    expect(
      drawCalls(calls),
      "the prepared event must not publish its packet generation before resource ownership succeeds",
    ).toHaveLength(drawsBeforeReplacement);

    expect(() => root.render(renderGraph)).not.toThrow();
    const replacementDraws = drawCalls(calls);
    expect(replacementDraws).toHaveLength(drawsBeforeReplacement + 1);
    expect(replacementDraws.at(-1)?.args[0]).toBe(gl.LINES);
    expect(root.snapshot().resourceLifetime).toMatchObject({
      preparedAssetEvents: 2,
      preparedAssetUpdates: 2,
    });
  });

  it("does not replay the active side effect or lose debt appended by reentry", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "side-effect-reentry" }),
    ]);
    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const empty = renderScene([]);
    vertexInputFault.beforeRetain = () => {
      vertexInputFault.beforeRetain = undefined;
      root.render(empty);
    };
    expect(() => root.flushInvalidated()).not.toThrow();
    expect(vertexInputFault.retainCalls).toBe(1);

    // The reentrant empty-scene commit appended release debt. If the outer
    // drain overwrote it, reacquiring this key conflicts with the stale state.
    expect(() => root.render(renderGraph)).not.toThrow();
  });

  it("does not resurrect committed-then-failed acquisition debt after disposal", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "dispose-acquisition-debt" }),
    ]);
    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const failure = new Error("geometry retain reported failure after commit");
    vertexInputFault.afterRetainFailure = failure;
    expect(() => root.flushInvalidated()).toThrow(failure);
    try {
      root.dispose();
    } catch {
      // Both cancelling obsolete acquisition debt during the first disposal
      // and retaining it for an explicit retry are valid teardown strategies.
    }
    const arena = vertexInputFault.arena as VertexInputArena;

    vertexInputFault.afterRetainFailure = undefined;
    expect(() => root.dispose()).not.toThrow();
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(0);
  });

  it("rejects reentrant disposal while resource effects are draining without leaking", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl));
    root.render(renderScene([
      gltf({ src: triangleGltfSrc, version: "dispose-during-resource-drain" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    let reentrantFailure: unknown;
    vertexInputFault.beforeRetain = () => {
      vertexInputFault.beforeRetain = undefined;
      try {
        root.dispose();
      } catch (error) {
        reentrantFailure = error;
      }
    };
    expect(() => root.flushInvalidated()).not.toThrow();
    expect(reentrantFailure).toEqual(new Error("Cannot dispose while Royal is applying resource events"));
    expect(root.disposed).toBe(false);

    const arena = vertexInputFault.arena as VertexInputArena;
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(1);
    expect(() => root.dispose()).not.toThrow();
    expect(vertexInputArenaSnapshot(arena).semanticGeometryCount).toBe(0);
  });

  it("does not replay prepared publication during synchronous handler reentry", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "prepared-handler-reentry" }),
    ]);
    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const original = Object.getOwnPropertyDescriptor(
      GltfImageDemandCoordinator.prototype,
      "registerAsset",
    )!.value as GltfImageDemandCoordinator["registerAsset"];
    let reentered = false;
    const register = vi.spyOn(GltfImageDemandCoordinator.prototype, "registerAsset");
    register.mockImplementation((input) => {
      const coordinator = register.mock.instances.at(-1)!;
      if (!reentered) {
        reentered = true;
        root.render(renderGraph);
      }
      return original.call(coordinator, input);
    });

    expect(() => root.flushInvalidated()).not.toThrow();
    expect(register).toHaveBeenCalledOnce();
    register.mockRestore();
  });

  it("does not demand or detach an obsolete image event after reentrant replacement", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "obsolete-image-event" }),
    ]);
    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const originalRegister = Object.getOwnPropertyDescriptor(
      GltfImageDemandCoordinator.prototype,
      "registerAsset",
    )!.value as GltfImageDemandCoordinator["registerAsset"];
    const register = vi.spyOn(GltfImageDemandCoordinator.prototype, "registerAsset");
    const demand = vi.spyOn(GltfImageDemandCoordinator.prototype, "demandAll");
    const detach = vi.spyOn(PreparedGltfAssetStore.prototype, "detachImagePreparation");
    register.mockImplementation((input) => {
      const coordinator = register.mock.instances.at(-1)!;
      root.render(renderScene([]));
      root.render(renderGraph);
      return originalRegister.call(coordinator, input);
    });

    expect(() => root.flushInvalidated()).not.toThrow();
    expect(register).toHaveBeenCalledOnce();
    expect(demand).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();

    const replacementDocument = solidTriangleDocument();
    replacementDocument.buffers = [{
      byteLength: triangleBinByteLength,
      uri: "replacement-after-obsolete-event.bin",
    }];
    replacementDocument.meshes[0]!.primitives[0]!.mode = 1;
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, replacementDocument))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/replacement-after-obsolete-event\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushPreparedAssetBoundary();

    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.LINES);
    expect(demand).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
  });
});
