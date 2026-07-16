import { boxGeometry, imageTexture, textureAsset } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  createResourceManifestDiffScratch,
  diffResourceManifests,
  gltfRequestKey,
  type FramePlanResourceManifest,
} from "../packages/renderer-webgl/src/frame/plan";
import {
  directGeometryDeclaration,
  directGeometryKey,
  gltfGeometryDeclaration,
} from "../packages/renderer-webgl/src/geometry-recipes";
import {
  applyPreparedAssetEvents,
  applyResourceDelta,
  createResourceArena,
  disposeResourceArena,
  resourceArenaCountersSnapshot,
  resourceArenaGeometrySnapshot,
  resourceArenaGltfRequestCount,
  resourceArenaGltfRequestSnapshot,
  resourceArenaRequiresHdrComposition,
  resourceArenaHasPendingAssetEvents,
  resourceArenaSourceCount,
  resourceArenaSourceReferenceCount,
  releaseResourceArenaPreparedSource,
  retainResourceArenaSourceLease,
  retainResourceArenaIblSource,
  retainResourceArenaPreparedSource,
  type PreparedAssetDependencyManifest,
  updatePreparedAssetManifest,
} from "../packages/renderer-webgl/src/resource-arena";
import type { PreparedGltfAsset } from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import { claimMonotonicId, MAX_RESOURCE_ID } from "../packages/renderer-webgl/src/resource-id";
import {
  createVertexInputArena,
  releaseLostVertexInputGeometry,
  retainVertexInputGeometry,
  vertexInputArenaSnapshot,
} from "../packages/renderer-webgl/src/vertex-input/arena";
import { runFuzzTraces } from "./fuzz";
const emptyManifest = (): FramePlanResourceManifest => ({
  bulkInstances: [],
  directGeometries: [],
  gltfRequests: [],
  ordinaryTextures: [],
  renderObjectRefs: [],
  virtualTextures: [],
});
const emptyAsset = (): PreparedGltfAsset => ({
  hasMaterialLod: false,
  hasMaterialVariants: false,
  hasNodeLod: false,
  lights: [],
  load: { imageFailures: 0, imageLoaded: 0, imageRequests: 0, startedAt: 0 },
  nodeCount: 0,
  primitives: [],
  variants: [],
});
const resourceArenaSnapshot = (arena: ReturnType<typeof createResourceArena>) => ({
  counters: { ...resourceArenaCountersSnapshot(arena) },
  geometries: new Map(resourceArenaGeometrySnapshot(arena)),
  gltfRequests: {
    get: (key: string) => {
      const request = resourceArenaGltfRequestSnapshot(arena, key);
      return request === undefined ? undefined : {
        count: request.count,
        generation: request.generation,
        plan: request.dependencyRevision === undefined ? undefined : {
          dependencyRevision: request.dependencyRevision,
          ordinaryTextures: new Map(
            request.ordinaryTextures?.map((entry) => [entry.key, entry]) ?? [],
          ),
        },
      };
    },
    get size() { return resourceArenaGltfRequestCount(arena); },
  },
  hdrCompositionAssetCount: resourceArenaRequiresHdrComposition(arena) ? 1 : 0,
  sourceReferences: { get size() { return resourceArenaSourceCount(arena); } },
});
const replayGeometryChanges = (
  vertexInputs: ReturnType<typeof createVertexInputArena>,
  changes: ReturnType<typeof applyResourceDelta>,
): void => {
  for (const acquired of changes.acquiredGeometryDeclarations) {
    retainVertexInputGeometry(vertexInputs, { geometryId: acquired.id, recipe: acquired.recipe });
  }
  for (const released of changes.releasedGeometryDeclarations) {
    releaseLostVertexInputGeometry(vertexInputs, released.id);
  }
};
describe("semantic resource arena properties", () => {
  it("admits decoded source identities before publication and deduplicates shared ownership", () => {
    const admitted: LoadedTextureSource[] = [];
    const denied = { value: undefined as LoadedTextureSource | undefined };
    const arena = createResourceArena(
      async () => emptyAsset(),
      () => undefined,
      { retain: (source) => {
        if (source === denied.value) throw new Error("decoded CPU denied");
        admitted.push(source);
      } },
    );
    const first = { height: 2, width: 2 } as LoadedTextureSource;
    const replacement = { height: 4, width: 4 } as LoadedTextureSource;

    const assetLease = retainResourceArenaSourceLease(arena, first);
    retainResourceArenaPreparedSource(arena, "ordinary", {
      source: first,
      texture: imageTexture("/shared.png"),
    });
    retainResourceArenaIblSource(arena, "ibl", "face", first);
    expect(admitted).toEqual([first]);
    expect(resourceArenaSourceReferenceCount(arena, first)).toBe(3);

    denied.value = replacement;
    expect(() => retainResourceArenaIblSource(arena, "ibl", "face", replacement))
      .toThrow("decoded CPU denied");
    expect(resourceArenaSourceReferenceCount(arena, first)).toBe(3);
    expect(resourceArenaSourceReferenceCount(arena, replacement)).toBe(0);

    assetLease.release();
    releaseResourceArenaPreparedSource(arena, "ordinary");
    expect(resourceArenaSourceReferenceCount(arena, first)).toBe(1);
    disposeResourceArena(arena);
    expect(resourceArenaSourceReferenceCount(arena, first)).toBe(0);
  });

  it("finishes every disposal phase while preserving changes and the first normalized failure", () => {
    const arena = createResourceArena(() => new Promise(() => undefined), () => undefined);
    const request = { count: 1, key: gltfRequestKey("/fault.gltf", 0), sourceUri: "/fault.gltf" };
    applyResourceDelta(arena, diffResourceManifests(
      emptyManifest(),
      { ...emptyManifest(), gltfRequests: [request] },
      createResourceManifestDiffScratch(),
    ));

    const state = arena as unknown as {
      readonly gltfRequests: Map<string, { subscription: { release(): void } }>;
      readonly preparedAssets: { dispose(): void };
      readonly sourceReferences: Map<LoadedTextureSource, number>;
    };
    state.gltfRequests.get(request.key)!.subscription.release = () => { throw "subscription failure"; };
    state.sourceReferences.set({} as LoadedTextureSource, 1);
    state.preparedAssets.dispose = () => { throw new Error("store failure"); };

    const result = disposeResourceArena(arena);
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("expected disposal failure");
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe("subscription failure");
    expect(result.changes.releasedGltfKeys).toEqual([request.key]);
    expect(state.gltfRequests.size).toBe(0);
    expect(state.sourceReferences.size).toBe(0);
  });

  it("guards production monotonic identity boundaries without mutable arena hooks", () => {
    expect(claimMonotonicId(MAX_RESOURCE_ID, MAX_RESOURCE_ID, "resource")).toBe(MAX_RESOURCE_ID);
    expect(() => claimMonotonicId(MAX_RESOURCE_ID + 1, MAX_RESOURCE_ID, "resource"))
      .toThrow(/ID space is exhausted/);
    expect(claimMonotonicId(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "static identity"))
      .toBe(Number.MAX_SAFE_INTEGER);
    expect(() => claimMonotonicId(Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, "static identity"))
      .toThrow(/ID space is exhausted/);
  });
  it("returns detached diagnostic snapshots", () => {
    const arena = createResourceArena(async () => emptyAsset(), () => undefined);
    const declaration = directGeometryDeclaration(boxGeometry([1, 2, 3]), "surface");
    applyResourceDelta(arena, diffResourceManifests(emptyManifest(), {
      ...emptyManifest(),
      directGeometries: [{
        count: 1,
        declaration,
        key: directGeometryKey(declaration.geometry, declaration.topology),
      }],
    }, createResourceManifestDiffScratch()));
    const first = resourceArenaSnapshot(arena);
    const key = directGeometryKey(declaration.geometry, declaration.topology);
    const row = first.geometries.get(key)!;
    const retainedPosition = row.recipe.positions[0]!;
    row.recipe.positions[0] = retainedPosition + 100;
    first.geometries.clear();
    first.counters.sceneLeaseAcquires = -1;
    const second = resourceArenaSnapshot(arena);
    expect(second.geometries.get(key)?.recipe.positions[0])
      .toBe(retainedPosition);
    expect(second.geometries.size).toBe(1);
    expect(second.counters.sceneLeaseAcquires).toBe(1);
  });
  it("preflights cross-asset geometry collisions before committing a prepared batch", async () => {
    const resolvers: Array<(asset: PreparedGltfAsset) => void> = [];
    const arena = createResourceArena(() => new Promise((resolve) => resolvers.push(resolve)), () => undefined);
    const requests = [0, 1].map((index) => ({
      count: 1,
      key: gltfRequestKey(`/batch-${index}.gltf`, 0),
      sourceUri: `/batch-${index}.gltf`,
    }));
    applyResourceDelta(arena, diffResourceManifests(emptyManifest(), {
      ...emptyManifest(),
      gltfRequests: requests,
    }, createResourceManifestDiffScratch()));
    const assets = [emptyAsset(), emptyAsset()];
    const assetIndex = new WeakMap(assets.map((asset, index) => [asset, index]));
    resolvers[0]!(assets[0]!);
    resolvers[1]!(assets[1]!);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => applyPreparedAssetEvents(arena, (asset) => ({
      geometries: [{
        count: 1,
        declaration: gltfGeometryDeclaration({
          mode: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, assetIndex.get(asset)!]),
        }),
        key: "shared-hostile-owner-key",
      }],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: false,
    }))).toThrow(/geometry identity collision/);
    expect(resourceArenaSnapshot(arena).geometries.size).toBe(0);
    expect(resourceArenaSnapshot(arena).counters.preparedAssetEvents).toBe(0);
    expect(resourceArenaSnapshot(arena).counters.assetPlanCompiles).toBe(0);
    expect(resourceArenaHasPendingAssetEvents(arena)).toBe(true);
  });
  it("fuzzes counted geometry changes replayed into the vertex-input semantic boundary", async () => {
    type Op = Readonly<{
      counts: readonly number[];
      dimensions: readonly number[];
    }>;
    await runFuzzTraces<Op>({
      cases: 12,
      operation: (random) => {
        const dimensions = [1, 2, 3, 4].filter(() => random.boolean(0.55));
        return {
          counts: dimensions.map(() => random.int(1, 5)),
          dimensions,
        };
      },
      run: (trace) => {
        const arena = createResourceArena(async () => emptyAsset(), () => undefined);
        const vertexInputs = createVertexInputArena();
        const scratch = createResourceManifestDiffScratch();
        let current = emptyManifest();
        for (const operation of trace) {
          const directGeometries = operation.dimensions.map((dimension, index) => {
            const declaration = directGeometryDeclaration(boxGeometry([dimension, dimension + 1, 1]), "surface");
            return {
              count: operation.counts[index] ?? 1,
              declaration,
              key: directGeometryKey(declaration.geometry, declaration.topology),
            };
          });
          const next = { ...emptyManifest(), directGeometries };
          replayGeometryChanges(vertexInputs, applyResourceDelta(
            arena,
            diffResourceManifests(current, next, scratch),
          ));
          current = next;
          expect(vertexInputArenaSnapshot(vertexInputs).semanticGeometryCount)
            .toBe(resourceArenaSnapshot(arena).geometries.size);
          expect(new Set([...resourceArenaSnapshot(arena).geometries.values()].map((row) => row.id))).toEqual(
            vertexInputArenaSnapshot(vertexInputs).semanticGeometryIds,
          );
        }
        replayGeometryChanges(vertexInputs, applyResourceDelta(
          arena,
          diffResourceManifests(current, emptyManifest(), scratch),
        ));
        expect(vertexInputArenaSnapshot(vertexInputs).semanticGeometryCount).toBe(0);
      },
      seed: 0x4e11_cafe,
      steps: 32,
    });
  });
  it("fuzzes generation, dependency, source, and disposal lifecycles from replayable traces", async () => {
    type Op =
      | { readonly kind: "live"; readonly value: boolean }
      | { readonly index: number; readonly kind: "settle"; readonly ready: boolean }
      | { readonly kind: "drain" }
      | { readonly kind: "replace"; readonly revision: number }
      | { readonly kind: "retain"; readonly slot: number; readonly token: number }
      | { readonly kind: "dispose" };
    await runFuzzTraces<Op>({
      cases: 12,
      operation: (random, step) => {
        const action = random.int(0, 9);
        if (action < 3) return { kind: "live", value: random.boolean() };
        if (action < 6) return { index: random.int(0, 16), kind: "settle", ready: random.boolean(0.75) };
        if (action === 6) return { kind: "drain" };
        if (action < 8) return { kind: "replace", revision: step };
        if (action === 8) return { kind: "retain", slot: random.int(0, 3), token: step };
        return { kind: "dispose" };
      },
      replayEnvName: "ROYAL_RESOURCE_ARENA_REPLAY",
      replays: [{
        label: "aba-stale-completion",
        value: [
          { kind: "live", value: true }, { kind: "live", value: false }, { kind: "live", value: true },
          { index: 0, kind: "settle", ready: true }, { kind: "drain" },
          { index: 1, kind: "settle", ready: true }, { kind: "drain" },
          { kind: "replace", revision: 1 },
          { kind: "retain", slot: 0, token: 1 },
          { kind: "retain", slot: 0, token: 2 }, { kind: "dispose" },
        ],
      }],
      run: async (trace, label) => {
        type Job = { readonly asset: PreparedGltfAsset; generation: number; readonly id: number;
          readonly reject: (error: Error) => void; readonly resolve: (asset: PreparedGltfAsset) => void; settled: boolean };
        const jobs: Job[] = [];
        const assetIds = new WeakMap<PreparedGltfAsset, number>();
        let wakes = 0;
        const arena = createResourceArena(() => new Promise((resolve, reject) => {
          const asset = emptyAsset();
          const job = { asset, generation: -1, id: jobs.length, reject, resolve, settled: false };
          jobs.push(job);
          assetIds.set(asset, job.id);
        }), () => { wakes += 1; });
        const scratch = createResourceManifestDiffScratch();
        const key = gltfRequestKey("/trace.gltf", 0);
        const request = { count: 1, key, sourceUri: "/trace.gltf" };
        const manifest = { ...emptyManifest(), gltfRequests: [request] };
        let live = false;
        let disposed = false;
        let nextGeneration = 1;
        let generation: number | undefined;
        let dependencyKey: string | undefined;
        const sourceSlots = new Map<number, {
          readonly lease: ReturnType<typeof retainResourceArenaSourceLease>;
          readonly source: LoadedTextureSource;
        }>();
        const sourceCounts = new Map<LoadedTextureSource, number>();
        const dependencies = (suffix: string): PreparedAssetDependencyManifest => ({
          geometries: [], iblKeys: [],
          ordinaryTextures: [{ count: 1, key: `ordinary:${suffix}`,
            texture: textureAsset({ contentKey: `content:${suffix}`, src: `/texture-${suffix}.png` }) }],
          virtualTextures: [], requiresHdrComposition: false,
        });
        const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
        const assertModel = (step: number) => {
          const snapshot = resourceArenaSnapshot(arena);
          expect(snapshot.gltfRequests.size, `${label} step=${step} requests`).toBe(live && !disposed ? 1 : 0);
          if (live && !disposed) {
            const row = snapshot.gltfRequests.get(key)!;
            expect(row.generation).toBe(generation);
            expect(row.plan === undefined ? undefined : [...row.plan.ordinaryTextures.keys()])
              .toEqual(dependencyKey === undefined ? undefined : [dependencyKey]);
          }
          expect(snapshot.sourceReferences.size).toBe(sourceCounts.size);
          for (const [source, count] of sourceCounts) expect(resourceArenaSourceReferenceCount(arena, source)).toBe(count);
          expect(snapshot.counters.preparedAssetAcquires - snapshot.counters.preparedAssetReleases)
            .toBe(snapshot.gltfRequests.size);
          expect(snapshot.counters.preparedAssetEvents).toBeLessThanOrEqual(wakes);
        };
        for (const [step, op] of trace.entries()) {
          if (op.kind === "live" && !disposed && op.value !== live) {
            const changes = applyResourceDelta(
              arena,
              diffResourceManifests(
                live ? manifest : emptyManifest(),
                op.value ? manifest : emptyManifest(),
                scratch,
              ),
            );
            live = op.value;
            dependencyKey = undefined;
            if (live) {
              generation = nextGeneration++;
              expect(changes.acquiredGltfRequests).toEqual([{ generation, request }]);
              jobs.at(-1)!.generation = generation;
            } else {
              expect(changes.acquiredGltfRequests).toEqual([]);
              generation = undefined;
              for (const slot of sourceSlots.values()) slot.lease.release();
              sourceSlots.clear();
              sourceCounts.clear();
            }
          } else if (op.kind === "settle" && jobs.length > 0) {
            const job = jobs[op.index % jobs.length]!;
            if (!job.settled) {
              job.settled = true;
              if (op.ready) job.resolve(job.asset); else job.reject(new Error(`failure-${job.id}`));
              await flush();
            }
          } else if (op.kind === "drain" && !disposed) {
            const applied = applyPreparedAssetEvents(arena, (asset) => dependencies(String(assetIds.get(asset))));
            for (const event of applied.events) {
              expect(event.snapshot.generation).toBe(generation);
              if (event.snapshot.status === "ready") dependencyKey = `ordinary:${assetIds.get(event.snapshot.asset)}`;
            }
          } else if (op.kind === "replace" && live && !disposed && dependencyKey !== undefined) {
            const previousRevision = resourceArenaSnapshot(arena).gltfRequests.get(key)!.plan!.dependencyRevision;
            dependencyKey = `ordinary:replacement-${op.revision}`;
            updatePreparedAssetManifest(arena, key, dependencies(`replacement-${op.revision}`));
            expect(resourceArenaSnapshot(arena).gltfRequests.get(key)!.plan!.dependencyRevision).toBe(previousRevision + 1);
          } else if (op.kind === "retain" && !disposed) {
            const source = { token: op.token } as unknown as LoadedTextureSource;
            const previous = sourceSlots.get(op.slot);
            previous?.lease.release();
            if (previous !== undefined) sourceCounts.delete(previous.source);
            sourceSlots.set(op.slot, {
              lease: retainResourceArenaSourceLease(arena, source),
              source,
            });
            sourceCounts.set(source, 1);
          } else if (op.kind === "dispose" && !disposed) {
            disposed = true;
            for (const slot of sourceSlots.values()) slot.lease.release();
            sourceSlots.clear();
            expect(disposeResourceArena(arena).kind).toBe("disposed");
            sourceCounts.clear();
            live = false;
            generation = undefined;
            dependencyKey = undefined;
          }
          await flush();
          assertModel(step);
        }
        if (!disposed) {
          for (const slot of sourceSlots.values()) slot.lease.release();
          disposeResourceArena(arena);
        }
      },
      seed: 0xa2e4_1e4f,
      steps: 48,
    });
  });
  it("coalesces N occurrences into one prepared request and one asset dependency edge", async () => {
    let resolve!: (asset: PreparedGltfAsset) => void;
    let loads = 0;
    let wakes = 0;
    const arena = createResourceArena(() => new Promise((next) => {
      loads += 1;
      resolve = next;
    }), () => { wakes += 1; });
    const request = { count: 100, key: gltfRequestKey("/shared.gltf", 1), sourceUri: "/shared.gltf" };
    const next = { ...emptyManifest(), gltfRequests: [request] };
    applyResourceDelta(arena, diffResourceManifests(emptyManifest(), next, createResourceManifestDiffScratch()));
    expect(loads).toBe(1);
    expect(resourceArenaSnapshot(arena).gltfRequests.get(request.key)?.count).toBe(100);
    resolve(emptyAsset());
    await Promise.resolve();
    await Promise.resolve();
    const geometryOwnerKey = "geometry-owner:shared:primitive:0:forced-bucket";
    const initialGeometry = gltfGeometryDeclaration({
      mode: "triangles",
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
    const applied = applyPreparedAssetEvents(arena, () => ({
      geometries: [{ count: 1, declaration: initialGeometry, key: geometryOwnerKey }],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: false,
    }));
    expect(applied.events).toHaveLength(1);
    expect(wakes).toBe(1);
    expect(resourceArenaSnapshot(arena).counters.assetPlanCompiles).toBe(1);
    expect(resourceArenaSnapshot(arena).hdrCompositionAssetCount).toBe(0);
    expect(resourceArenaRequiresHdrComposition(arena)).toBe(false);
    const retainedGeometry = resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.recipe;
    const retainedGeometryId = resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.id;
    expect(retainedGeometry).toBeDefined();
    expect(retainedGeometryId).toBeTypeOf("number");
    updatePreparedAssetManifest(arena, request.key, {
      geometries: [{
        count: 1,
        declaration: gltfGeometryDeclaration({
          mode: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        }),
        key: geometryOwnerKey,
      }],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: false,
    });
    expect(resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.recipe).toEqual(retainedGeometry);
    expect(resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.id).toBe(retainedGeometryId);
    const duplicateGeometry = {
      count: 1,
      declaration: initialGeometry,
      key: geometryOwnerKey,
    };
    expect(() => updatePreparedAssetManifest(arena, request.key, {
      geometries: [duplicateGeometry, duplicateGeometry],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: false,
    })).toThrow(/duplicate key/);
    expect(resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.recipe).toEqual(retainedGeometry);
    expect(() => updatePreparedAssetManifest(arena, request.key, {
      geometries: [{
        count: 1,
        declaration: gltfGeometryDeclaration({
          mode: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]),
        }),
        key: geometryOwnerKey,
      }],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: false,
    })).toThrow(/geometry identity collision/);
    expect(resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.recipe).toEqual(retainedGeometry);
    for (const invalidCount of [0, -1, 1.5]) {
      const dependencyRevision = resourceArenaSnapshot(arena).gltfRequests.get(request.key)?.plan?.dependencyRevision;
      expect(() => updatePreparedAssetManifest(arena, request.key, {
        geometries: [{ count: invalidCount, declaration: initialGeometry, key: "geometry-owner:invalid-count" }],
        iblKeys: [],
        ordinaryTextures: [],
        virtualTextures: [],
        requiresHdrComposition: false,
      })).toThrow(/positive safe integer/);
      expect(resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.recipe).toEqual(retainedGeometry);
      expect(resourceArenaSnapshot(arena).geometries.has("geometry-owner:invalid-count")).toBe(false);
      expect(resourceArenaSnapshot(arena).gltfRequests.get(request.key)?.plan?.dependencyRevision).toBe(dependencyRevision);
    }
    const dependencyRevisionBeforeLaterFailure = resourceArenaSnapshot(arena).gltfRequests.get(request.key)?.plan?.dependencyRevision;
    expect(() => updatePreparedAssetManifest(arena, request.key, {
      geometries: [{
        count: 1,
        declaration: gltfGeometryDeclaration({
          mode: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 2]),
        }),
        key: "geometry-owner:must-not-commit",
      }],
      iblKeys: [{ count: 0, key: "invalid-later-dependency" }],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: true,
    })).toThrow(/positive safe integer/);
    expect(resourceArenaSnapshot(arena).geometries.get(geometryOwnerKey)?.recipe).toEqual(retainedGeometry);
    expect(resourceArenaSnapshot(arena).geometries.has("geometry-owner:must-not-commit")).toBe(false);
    expect(resourceArenaSnapshot(arena).gltfRequests.get(request.key)?.plan?.dependencyRevision)
      .toBe(dependencyRevisionBeforeLaterFailure);
    expect(resourceArenaSnapshot(arena).hdrCompositionAssetCount).toBe(0);
    const replacementGeometryKey = "geometry-owner:shared:primitive:0:changed-content";
    const geometryChanges = updatePreparedAssetManifest(arena, request.key, {
      geometries: [{
        count: 1,
        declaration: gltfGeometryDeclaration({
          mode: "triangles",
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]),
        }),
        key: replacementGeometryKey,
      }],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: false,
    });
    expect(geometryChanges.releasedGeometryDeclarations.map((entry) => entry.key)).toEqual([geometryOwnerKey]);
    expect(geometryChanges.releasedGeometryDeclarations[0]?.id).toBe(retainedGeometryId);
    expect(geometryChanges.acquiredGeometryDeclarations.map((entry) => entry.key))
      .toEqual([replacementGeometryKey]);
    expect(resourceArenaSnapshot(arena).geometries.has(geometryOwnerKey)).toBe(false);
    expect(resourceArenaSnapshot(arena).geometries.has(replacementGeometryKey)).toBe(true);
    expect(resourceArenaSnapshot(arena).geometries.get(replacementGeometryKey)!.id).toBeGreaterThan(retainedGeometryId!);
    updatePreparedAssetManifest(arena, request.key, {
      geometries: [],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      requiresHdrComposition: true,
    });
    expect(resourceArenaRequiresHdrComposition(arena)).toBe(true);
    const source = {} as LoadedTextureSource;
    const sourceLease = retainResourceArenaSourceLease(arena, source);
    retainResourceArenaPreparedSource(arena, "prepared", {
      source,
      texture: imageTexture({ src: "/texture.png" }),
    });
    expect(resourceArenaSourceReferenceCount(arena, source)).toBe(2);
    sourceLease.release();
    const disposed = disposeResourceArena(arena);
    expect(disposed.changes.releasedSources).toEqual([source]);
    expect(resourceArenaSourceReferenceCount(arena, source)).toBe(0);
    expect(resourceArenaRequiresHdrComposition(arena)).toBe(false);
    expect(resourceArenaSnapshot(arena).counters.preparedAssetAcquires).toBe(resourceArenaSnapshot(arena).counters.preparedAssetReleases);
    expect(resourceArenaSnapshot(arena).counters.sceneLeaseAcquires).toBe(resourceArenaSnapshot(arena).counters.sceneLeaseReleases);
  });
});
