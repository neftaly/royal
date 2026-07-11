import { boxGeometry, imageTexture, virtualTexture, type TextureContentKey, type VirtualTextureAssetRef } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  createResourceManifestDiffScratch,
  diffResourceManifests,
  gltfRequestKey,
  type FramePlanResourceManifest,
} from "../packages/renderer-webgl/src/frame-plan";
import { MAX_FRAME_PACKET_RESOURCE_ID } from "../packages/renderer-webgl/src/frame-packets";
import {
  directGeometryDeclaration,
  directGeometryDeclarationKey,
  gltfGeometryDeclaration,
} from "../packages/renderer-webgl/src/geometry-recipes";
import {
  applyPreparedAssetEvents,
  applyResourceDelta,
  createResourceArena,
  disposeResourceArena,
  publishResourceArenaContentKey,
  rekeyPreparedAssetOrdinaryTextures,
  resourceArenaContentKeys,
  resourceArenaHasHdrReadyAsset,
  resourceArenaHasPendingAssetEvents,
  resourceArenaIblSources,
  resourceArenaSourceReferenceCount,
  retainResourceArenaAssetSource,
  retainResourceArenaIblSource,
  retainResourceArenaPreparedSource,
  type PreparedAssetDependencyManifest,
  updatePreparedAssetManifest,
} from "../packages/renderer-webgl/src/resource-arena";
import type { PreparedGltfAsset } from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture-sources";
import {
  releaseLostVertexInputGeometry,
  retainVertexInputGeometry,
  vertexInputArenaSnapshot,
} from "../packages/renderer-webgl/src/vertex-input-arena";
import { fuzzCaseCount, SeededRandom } from "./fuzz";

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

const replayGeometryChanges = (
  arena: ReturnType<typeof createResourceArena>,
  changes: ReturnType<typeof applyResourceDelta>,
): void => {
  for (const acquired of changes.acquiredGeometryDeclarations) {
    retainVertexInputGeometry(arena.vertexInputs, { geometryId: acquired.id, recipe: acquired.recipe });
  }
  for (const released of changes.releasedGeometryDeclarations) {
    releaseLostVertexInputGeometry(arena.vertexInputs, released.id);
  }
};

describe("semantic resource arena properties", () => {
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
      wantsHdr: false,
    }))).toThrow(/geometry identity collision/);
    expect(arena.geometries.size).toBe(0);
    expect(arena.counters.preparedAssetEvents).toBe(0);
    expect(arena.counters.assetPlanCompiles).toBe(0);
    expect(resourceArenaHasPendingAssetEvents(arena)).toBe(true);
  });

  it("fuzzes counted geometry changes replayed into the vertex-input semantic boundary", () => {
    const arena = createResourceArena(async () => emptyAsset(), () => undefined);
    const scratch = createResourceManifestDiffScratch();
    const random = new SeededRandom(0x4e11_cafe);
    let current = emptyManifest();
    for (let step = 0; step < fuzzCaseCount(256); step += 1) {
      const dimensions = [1, 2, 3, 4].filter(() => random.boolean(0.55));
      const directGeometries = dimensions.map((dimension) => {
        const declaration = directGeometryDeclaration(boxGeometry([dimension, dimension + 1, 1]), "surface");
        return {
          count: random.int(1, 5),
          declaration,
          key: directGeometryDeclarationKey(declaration),
        };
      });
      const next = { ...emptyManifest(), directGeometries };
      const changes = applyResourceDelta(arena, diffResourceManifests(current, next, scratch));
      replayGeometryChanges(arena, changes);
      current = next;
      expect(vertexInputArenaSnapshot(arena.vertexInputs).semanticGeometryCount).toBe(arena.geometries.size);
      expect(new Set([...arena.geometries.values()].map((row) => row.id))).toEqual(
        new Set(arena.vertexInputs.semantics.keys()),
      );
    }
    replayGeometryChanges(arena, applyResourceDelta(
      arena,
      diffResourceManifests(current, emptyManifest(), scratch),
    ));
    expect(vertexInputArenaSnapshot(arena.vertexInputs).semanticGeometryCount).toBe(0);
  });

  it("fuzzes stale generations, interleaved publication, dependency revisions, and disposal", async () => {
    const cases = fuzzCaseCount(48);
    for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
      const random = new SeededRandom((0xa2e4_1e4f ^ Math.imul(caseIndex + 1, 0x9e37_79b9)) >>> 0);
      type PendingJob = {
        generation: number;
        readonly id: number;
        reject(error: Error): void;
        resolve(asset: PreparedGltfAsset): void;
        settled: boolean;
        readonly signal: AbortSignal;
      };
      const jobs: PendingJob[] = [];
      const assetJobIds = new WeakMap<PreparedGltfAsset, number>();
      let wakes = 0;
      const arena = createResourceArena((_request, signal) => new Promise((resolve, reject) => {
        const job: PendingJob = {
          generation: -1,
          id: jobs.length,
          reject,
          resolve,
          settled: false,
          signal,
        };
        jobs.push(job);
      }), () => { wakes += 1; });
      const scratch = createResourceManifestDiffScratch();
      const key = gltfRequestKey("/racy.gltf", 0);
      const request = { count: 1, key, sourceUri: "/racy.gltf" };
      const directDeclaration = directGeometryDeclaration(boxGeometry([1, 2, 3]), "surface");
      const directKey = directGeometryDeclarationKey(directDeclaration);
      const liveManifest = {
        ...emptyManifest(),
        directGeometries: [{ count: 2, declaration: directDeclaration, key: directKey }],
        gltfRequests: [request],
      };
      let current = emptyManifest();

      const setLive = (live: boolean) => {
        const next = live ? liveManifest : emptyManifest();
        const result = applyResourceDelta(arena, diffResourceManifests(current, next, scratch));
        current = next;
        if (live) {
          const declaration = arena.gltfRequests.get(key)!;
          const job = jobs[jobs.length - 1]!;
          if (job.generation < 0) job.generation = declaration.generation;
        } else expect(resourceArenaContentKeys(arena, key).size).toBe(0);
        return result;
      };
      const dependencyManifest = (
        suffix: string,
        wantsHdr: boolean,
      ): PreparedAssetDependencyManifest => ({
        geometries: [{
          count: 1,
          declaration: gltfGeometryDeclaration({
            mode: "triangles",
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, Number.parseInt(suffix, 10) || 0]),
          }),
          key: `geometry-owner:${suffix}`,
        }],
        iblKeys: wantsHdr ? [{ count: 1, key: `ibl:${suffix}` }] : [],
        ordinaryTextures: [0, 1].map((slot) => ({
          count: 1,
          key: `ordinary:${suffix}:${slot}`,
          texture: imageTexture({ contentKey: `content:${suffix}:${slot}`, src: `/texture-${suffix}-${slot}.png` }),
        })),
        virtualTextures: random.boolean(0.25) ? [{
          count: 1,
          key: `virtual:${suffix}`,
          texture: virtualTexture({ contentKey: `vt:${suffix}`, src: `/texture-${suffix}.json` }) as VirtualTextureAssetRef,
        }] : [],
        wantsHdr,
      });
      const compileManifest = (asset: PreparedGltfAsset, contentKeys: ReadonlyMap<string, TextureContentKey>) => {
        const jobId = assetJobIds.get(asset);
        if (jobId === undefined) throw new Error("ready asset was not produced by this fuzz run");
        const published = contentKeys.get("/decoded.png");
        return dependencyManifest(`${jobId}:${published ?? "initial"}`, (jobId & 1) === 0);
      };
      const flushPublications = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      const drain = () => applyPreparedAssetEvents(arena, compileManifest);
      const assertConserved = () => {
        for (const declaration of arena.gltfRequests.values()) {
          expect(declaration.count).toBeGreaterThan(0);
          expect(declaration.plan?.generation ?? declaration.generation).toBe(declaration.generation);
          for (const entry of declaration.plan?.ordinaryTextures.values() ?? []) expect(entry.key).toBeTypeOf("string");
          for (const entry of declaration.plan?.virtualTextures ?? []) expect(entry.key).toBeTypeOf("string");
        }
        for (const declaration of [...arena.ordinaryTextures.values(), ...arena.virtualTextures.values()]) {
          expect(declaration.sceneReferences).toBeGreaterThanOrEqual(0);
          expect(declaration.assetReferences).toBeGreaterThanOrEqual(0);
          expect(declaration.sceneReferences + declaration.assetReferences).toBeGreaterThan(0);
        }
        for (const geometry of arena.geometries.values()) {
          expect(geometry.sceneReferences).toBeGreaterThanOrEqual(0);
          expect(geometry.assetReferences).toBeGreaterThanOrEqual(0);
          expect(geometry.sceneReferences + geometry.assetReferences).toBeGreaterThan(0);
        }
        const expectedSourceReferences = new Map<LoadedTextureSource, number>();
        const countSource = (source: LoadedTextureSource) => {
          expectedSourceReferences.set(source, (expectedSourceReferences.get(source) ?? 0) + 1);
        };
        for (const sources of arena.assetSources.values()) for (const source of sources.values()) countSource(source);
        for (const sources of arena.iblSources.values()) for (const source of sources.values()) countSource(source);
        for (const prepared of arena.preparedSources.values()) countSource(prepared.source);
        expect(arena.sourceReferences.size).toBe(expectedSourceReferences.size);
        for (const [source, count] of expectedSourceReferences) {
          expect(resourceArenaSourceReferenceCount(arena, source)).toBe(count);
        }
        const plannedHdr = [...arena.gltfRequests.values()].filter((entry) => entry.plan?.wantsHdr).length;
        expect(arena.hdrReadyAssetCount).toBe(plannedHdr);
        expect(resourceArenaHasHdrReadyAsset(arena)).toBe(plannedHdr > 0);
        const liveSceneLeases = [...arena.gltfRequests.values()].reduce((sum, entry) => sum + entry.count, 0)
          + [...arena.ordinaryTextures.values()].reduce((sum, entry) => sum + entry.sceneReferences, 0)
          + [...arena.virtualTextures.values()].reduce((sum, entry) => sum + entry.sceneReferences, 0)
          + [...arena.geometries.values()].reduce((sum, entry) => sum + entry.sceneReferences, 0);
        expect(arena.counters.sceneLeaseAcquires - arena.counters.sceneLeaseReleases).toBe(liveSceneLeases);
        expect(arena.counters.preparedAssetAcquires - arena.counters.preparedAssetReleases)
          .toBe(arena.gltfRequests.size);
        expect(arena.counters.preparedAssetEvents).toBeLessThanOrEqual(wakes);
        expect(arena.counters.assetPlanCompiles).toBeLessThanOrEqual(arena.counters.preparedAssetUpdates);
      };
      const settle = async (job: PendingJob, ready: boolean, releaseBeforePublish = false) => {
        if (job.settled) return;
        job.settled = true;
        const wakeBefore = wakes;
        const wasCurrent = arena.gltfRequests.get(key)?.generation === job.generation;
        if (ready) {
          const asset = emptyAsset();
          assetJobIds.set(asset, job.id);
          job.resolve(asset);
        } else job.reject(new Error(`failure-${job.id}`));
        if (releaseBeforePublish && current === liveManifest) setLive(false);
        const remainsCurrent = wasCurrent && arena.gltfRequests.get(key)?.generation === job.generation;
        const alreadyPending = arena.pendingAssetKeySet.has(key);
        await flushPublications();
        expect(wakes - wakeBefore).toBe(remainsCurrent && !alreadyPending ? 1 : 0);
      };

      // Every case contains the essential ABA race: generation 1 completes only
      // after generation 2 owns the same semantic key.
      setLive(true);
      const staleJob = jobs[0]!;
      setLive(false);
      expect(staleJob.signal.aborted).toBe(true);
      setLive(true);
      const replacementJob = jobs[1]!;
      await settle(staleJob, random.boolean());
      expect(drain().events).toHaveLength(0);
      expect(arena.gltfRequests.get(key)?.generation).toBe(replacementJob.generation);

      for (let step = 0; step < 36; step += 1) {
        const action = random.int(0, 9);
        if (action === 0 && current === liveManifest) setLive(false);
        else if (action === 1 && current !== liveManifest) setLive(true);
        else if (action === 2) {
          const candidates = jobs.filter((job) => !job.settled);
          if (candidates.length > 0) {
            await settle(random.pick(candidates), random.boolean(0.7), random.boolean(0.2));
          }
        } else if (action === 3) {
          const result = drain();
          const declaration = arena.gltfRequests.get(key);
          for (const event of result.events) {
            expect(event.snapshot.generation).toBe(declaration?.generation);
            if (event.snapshot.status === "ready") {
              expect(assetJobIds.get(event.snapshot.asset)).toBe(
                jobs.find((job) => job.generation === declaration?.generation)?.id,
              );
              expect(declaration?.plan?.sourceRevision).toBe(event.snapshot.revision);
            }
          }
        } else if (action === 4 && arena.gltfRequests.get(key)?.plan !== undefined) {
          const revision = `${caseIndex}-${step}`;
          const plan = arena.gltfRequests.get(key)!.plan!;
          const previousDependencyRevision = plan.dependencyRevision;
          const previousSourceRevision = plan.sourceRevision;
          publishResourceArenaContentKey(arena, key, "/decoded.png", `decoded:${revision}`);
          updatePreparedAssetManifest(arena, key, dependencyManifest(revision, random.boolean()));
          expect(resourceArenaContentKeys(arena, key).get("/decoded.png")).toBe(`decoded:${revision}`);
          const updatedPlan = arena.gltfRequests.get(key)!.plan!;
          expect(updatedPlan.dependencyRevision).toBe(previousDependencyRevision + 1);
          expect(updatedPlan.sourceRevision).toBe(previousSourceRevision);
        } else if (action === 5 && arena.gltfRequests.has(key)) {
          const source = { fuzzSource: `${caseIndex}:${step}` } as unknown as LoadedTextureSource;
          retainResourceArenaAssetSource(arena, key, `slot:${step % 3}`, source);
        } else if (action === 6 && arena.iblReferences.size > 0) {
          const iblKey = random.pick([...arena.iblReferences.keys()]);
          const source = { fuzzIbl: `${caseIndex}:${step}` } as unknown as LoadedTextureSource;
          retainResourceArenaIblSource(arena, iblKey, `face:${step % 2}`, source);
          expect(resourceArenaIblSources(arena, iblKey)?.size).toBeGreaterThan(0);
        } else if (action === 7) {
          const source = { fuzzPrepared: `${caseIndex}:${step}` } as unknown as LoadedTextureSource;
          retainResourceArenaPreparedSource(arena, `prepared:${step % 2}`, {
            source,
            texture: imageTexture({ src: `/prepared-${step}.png` }),
          });
        } else if (action === 8) {
          const plan = arena.gltfRequests.get(key)?.plan;
          const previous = [...(plan?.ordinaryTextures.values() ?? [])].slice(0, 2);
          if (previous.length > 0) {
            const merged = {
              count: 1,
              key: `ordinary:merged:${caseIndex}:${step}`,
              texture: imageTexture({ contentKey: `merged:${caseIndex}:${step}`, src: `/merged-${step}.png` }),
            };
            if (random.boolean(0.2)) {
              const texturesBefore = [...arena.ordinaryTextures.entries()].map(([entryKey, entry]) => [
                entryKey, entry.assetReferences, entry.sceneReferences,
              ]);
              const planBefore = [...plan!.ordinaryTextures.entries()].map(([entryKey, entry]) => [entryKey, entry.count]);
              expect(() => rekeyPreparedAssetOrdinaryTextures(arena, key, [{
                next: { ...merged, count: previous[0]!.count + 1 },
                previous: { ...previous[0]!, count: previous[0]!.count + 1 },
              }])).toThrow(/exceeds retained references/);
              expect([...arena.ordinaryTextures.entries()].map(([entryKey, entry]) => [
                entryKey, entry.assetReferences, entry.sceneReferences,
              ])).toEqual(texturesBefore);
              expect([...plan!.ordinaryTextures.entries()].map(([entryKey, entry]) => [entryKey, entry.count]))
                .toEqual(planBefore);
            } else {
              const previousDependencyRevision = plan!.dependencyRevision;
              const previousSourceRevision = plan!.sourceRevision;
              rekeyPreparedAssetOrdinaryTextures(arena, key, previous.map((entry) => ({
                next: { ...merged, count: entry.count },
                previous: entry,
              })));
              expect(plan!.dependencyRevision).toBe(previousDependencyRevision + 1);
              expect(plan!.sourceRevision).toBe(previousSourceRevision);
              expect(plan!.ordinaryTextures.get(merged.key)?.count)
                .toBe(previous.reduce((sum, entry) => sum + entry.count, 0));
            }
          }
        }
        assertConserved();
      }

      // Resolve every outstanding job in a random status/order. Aborted stale
      // jobs may still settle; neither status may become visible in the arena.
      const unsettled = [...jobs];
      for (let index = unsettled.length - 1; index > 0; index -= 1) {
        const swapIndex = random.int(0, index + 1);
        [unsettled[index], unsettled[swapIndex]] = [unsettled[swapIndex]!, unsettled[index]!];
      }
      for (const job of unsettled) {
        await settle(job, random.boolean());
        const result = drain();
        for (const event of result.events) {
          expect(event.snapshot.generation).toBe(arena.gltfRequests.get(key)?.generation);
        }
      }
      const disposed = disposeResourceArena(arena);
      expect(new Set(disposed.releasedSources).size).toBe(disposed.releasedSources.length);
      expect(arena.gltfRequests.size).toBe(0);
      expect(arena.ordinaryTextures.size).toBe(0);
      expect(arena.virtualTextures.size).toBe(0);
      expect(arena.geometries.size).toBe(0);
      expect(arena.sourceReferences.size).toBe(0);
      expect(arena.hdrReadyAssetCount).toBe(0);
      expect(arena.counters.preparedAssetAcquires).toBe(arena.counters.preparedAssetReleases);
      expect(arena.counters.sceneLeaseAcquires).toBe(arena.counters.sceneLeaseReleases);
      await flushPublications();
    }
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
    expect(arena.gltfRequests.get(request.key)?.count).toBe(100);
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
      wantsHdr: false,
    }));
    expect(applied.events).toHaveLength(1);
    expect(wakes).toBe(1);
    expect(arena.counters.assetPlanCompiles).toBe(1);
    expect(arena.hdrReadyAssetCount).toBe(0);
    expect(resourceArenaHasHdrReadyAsset(arena)).toBe(false);
    const retainedGeometry = arena.geometries.get(geometryOwnerKey)?.recipe;
    const retainedGeometryId = arena.geometries.get(geometryOwnerKey)?.id;
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
      wantsHdr: false,
    });
    expect(arena.geometries.get(geometryOwnerKey)?.recipe).toBe(retainedGeometry);
    expect(arena.geometries.get(geometryOwnerKey)?.id).toBe(retainedGeometryId);
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
      wantsHdr: false,
    })).toThrow(/duplicate key/);
    expect(arena.geometries.get(geometryOwnerKey)?.recipe).toBe(retainedGeometry);
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
      wantsHdr: false,
    })).toThrow(/geometry identity collision/);
    expect(arena.geometries.get(geometryOwnerKey)?.recipe).toBe(retainedGeometry);
    for (const invalidCount of [0, -1, 1.5]) {
      const dependencyRevision = arena.gltfRequests.get(request.key)?.plan?.dependencyRevision;
      expect(() => updatePreparedAssetManifest(arena, request.key, {
        geometries: [{ count: invalidCount, declaration: initialGeometry, key: "geometry-owner:invalid-count" }],
        iblKeys: [],
        ordinaryTextures: [],
        virtualTextures: [],
        wantsHdr: false,
      })).toThrow(/positive safe integer/);
      expect(arena.geometries.get(geometryOwnerKey)?.recipe).toBe(retainedGeometry);
      expect(arena.geometries.has("geometry-owner:invalid-count")).toBe(false);
      expect(arena.gltfRequests.get(request.key)?.plan?.dependencyRevision).toBe(dependencyRevision);
    }
    const dependencyRevisionBeforeLaterFailure = arena.gltfRequests.get(request.key)?.plan?.dependencyRevision;
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
      wantsHdr: true,
    })).toThrow(/positive safe integer/);
    expect(arena.geometries.get(geometryOwnerKey)?.recipe).toBe(retainedGeometry);
    expect(arena.geometries.has("geometry-owner:must-not-commit")).toBe(false);
    expect(arena.gltfRequests.get(request.key)?.plan?.dependencyRevision)
      .toBe(dependencyRevisionBeforeLaterFailure);
    expect(arena.hdrReadyAssetCount).toBe(0);
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
      wantsHdr: false,
    });
    expect(geometryChanges.releasedGeometryDeclarations.map((entry) => entry.key)).toEqual([geometryOwnerKey]);
    expect(geometryChanges.releasedGeometryDeclarations[0]?.id).toBe(retainedGeometryId);
    expect(geometryChanges.acquiredGeometryDeclarations.map((entry) => entry.key))
      .toEqual([replacementGeometryKey]);
    expect(arena.geometries.has(geometryOwnerKey)).toBe(false);
    expect(arena.geometries.has(replacementGeometryKey)).toBe(true);
    expect(arena.geometries.get(replacementGeometryKey)!.id).toBeGreaterThan(retainedGeometryId!);
    publishResourceArenaContentKey(arena, request.key, "/texture.png", "decoded-texture");
    expect(resourceArenaContentKeys(arena, request.key).get("/texture.png")).toBe("decoded-texture");
    updatePreparedAssetManifest(arena, request.key, {
      geometries: [],
      iblKeys: [],
      ordinaryTextures: [],
      virtualTextures: [],
      wantsHdr: true,
    });
    expect(resourceArenaHasHdrReadyAsset(arena)).toBe(true);
    const source = {} as LoadedTextureSource;
    retainResourceArenaAssetSource(arena, request.key, "image:0", source);
    retainResourceArenaPreparedSource(arena, "prepared", {
      source,
      texture: imageTexture({ src: "/texture.png" }),
    });
    expect(resourceArenaSourceReferenceCount(arena, source)).toBe(2);
    const disposed = disposeResourceArena(arena);
    expect(disposed.releasedSources).toEqual([source]);
    expect(resourceArenaSourceReferenceCount(arena, source)).toBe(0);
    expect(resourceArenaHasHdrReadyAsset(arena)).toBe(false);
    expect(arena.counters.preparedAssetAcquires).toBe(arena.counters.preparedAssetReleases);
    expect(arena.counters.sceneLeaseAcquires).toBe(arena.counters.sceneLeaseReleases);

    const boundaryArena = createResourceArena(async () => emptyAsset(), () => undefined);
    boundaryArena.nextGeometryId = MAX_FRAME_PACKET_RESOURCE_ID;
    const boundaryDeclaration = directGeometryDeclaration(boxGeometry([9, 8, 7]), "surface");
    const boundaryKey = directGeometryDeclarationKey(boundaryDeclaration);
    const boundaryManifest = {
      ...emptyManifest(),
      directGeometries: [{ count: 1, declaration: boundaryDeclaration, key: boundaryKey }],
    };
    const boundaryScratch = createResourceManifestDiffScratch();
    const boundaryAcquire = applyResourceDelta(
      boundaryArena,
      diffResourceManifests(emptyManifest(), boundaryManifest, boundaryScratch),
    );
    replayGeometryChanges(boundaryArena, boundaryAcquire);
    expect(boundaryAcquire.acquiredGeometryDeclarations[0]?.id).toBe(MAX_FRAME_PACKET_RESOURCE_ID);
    replayGeometryChanges(boundaryArena, applyResourceDelta(
      boundaryArena,
      diffResourceManifests(boundaryManifest, emptyManifest(), boundaryScratch),
    ));
    const exhaustedDeclaration = directGeometryDeclaration(boxGeometry([9, 8, 6]), "surface");
    const exhaustedKey = directGeometryDeclarationKey(exhaustedDeclaration);
    expect(() => applyResourceDelta(boundaryArena, diffResourceManifests(emptyManifest(), {
      ...emptyManifest(),
      directGeometries: [{ count: 1, declaration: exhaustedDeclaration, key: exhaustedKey }],
    }, boundaryScratch))).toThrow(/ID space is exhausted/);
    expect(boundaryArena.geometries.size).toBe(0);
    expect(vertexInputArenaSnapshot(boundaryArena.vertexInputs).semanticGeometryCount).toBe(0);
  });
});
