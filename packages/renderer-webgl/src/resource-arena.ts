import type { TextureAssetRef, TextureContentKey, VirtualTextureAssetRef } from "@royal/renderer-core";
import type {
  CountedDirectGeometryDeclaration,
  CountedGltfRequest,
  CountedTextureDeclaration,
  ResourceManifestDelta,
} from "./frame-plan";
import { claimMonotonicId, MAX_RESOURCE_ID } from "./resource-id";
import {
  normalizeGeometryDeclaration,
  type CpuGeometry,
  type GeometryDeclaration,
} from "./geometry-recipes";
import {
  PreparedGltfAssetStore,
  type PrepareGltfAssetJob,
  type PreparedGltfAsset,
  type PreparedGltfAssetSnapshot,
  type PreparedGltfAssetSubscription,
} from "./gltf/prepared-asset";
import type { LoadedTextureSource } from "./texture-sources";
import { sameGeometryBytes } from "./webgl/geometry-identity";

export interface PreparedTextureSource {
  readonly source: LoadedTextureSource;
  readonly texture: TextureAssetRef & {
    readonly flipY?: boolean;
    readonly preparedOnly?: boolean;
  };
}

export interface ResourceArenaSourceLease {
  /** Releases this owner exactly once. Returns true when no source owner remains. */
  release(): boolean;
}

export interface PreparedAssetDependencyManifest {
  readonly geometries: readonly CountedGeometryDeclaration[];
  readonly iblKeys: readonly { readonly count: number; readonly key: string }[];
  readonly ordinaryTextures: readonly CountedTextureDeclaration<TextureAssetRef>[];
  readonly virtualTextures: readonly CountedTextureDeclaration<VirtualTextureAssetRef>[];
  readonly wantsHdr: boolean;
}

export interface CountedGeometryDeclaration {
  readonly count: number;
  readonly declaration: GeometryDeclaration;
  readonly key: string;
}

type TextureDeclaration<Texture> = {
  assetReferences: number;
  readonly key: string;
  sceneReferences: number;
  texture: Texture;
};

type GltfRequestDeclaration = {
  count: number;
  generation: number;
  readonly key: string;
  plan: PreparedAssetPlan | undefined;
  readonly sourceUri: string;
  subscription: PreparedGltfAssetSubscription;
};

type PreparedAssetPlan = {
  dependencyRevision: number;
  readonly generation: number;
  readonly geometries: Map<string, MutableCountedGeometryDeclaration>;
  readonly iblKeys: readonly { readonly count: number; readonly key: string }[];
  readonly ordinaryTextures: Map<string, MutableCountedTextureDeclaration<TextureAssetRef>>;
  sourceRevision: number;
  readonly virtualTextures: readonly CountedTextureDeclaration<VirtualTextureAssetRef>[];
  readonly wantsHdr: boolean;
};

type MutableCountedGeometryDeclaration = {
  count: number;
  declaration: GeometryDeclaration;
  readonly key: string;
};

type MutableCountedTextureDeclaration<Texture> = {
  count: number;
  readonly key: string;
  readonly texture: Texture;
};

export interface PreparedAssetOrdinaryTextureRekey {
  readonly next: CountedTextureDeclaration<TextureAssetRef>;
  readonly previous: CountedTextureDeclaration<TextureAssetRef>;
}

export interface ResourceArenaCounters {
  assetPlanCompiles: number;
  preparedAssetAcquires: number;
  preparedAssetEvents: number;
  preparedAssetReleases: number;
  preparedAssetUpdates: number;
  sceneLeaseAcquires: number;
  sceneLeaseReleases: number;
}

export interface ResourceArenaOrdinaryTextureResidencySnapshot {
  readonly activeLeases: number;
  readonly activeReferences: number;
}

/** Cold diagnostic/property view. Every container and mutable row is detached. */
export const resourceArenaSnapshot = (arena: ResourceArena) => {
  const state = arena as unknown as ResourceArenaState;
  const copyGeometryArray = <Array extends Float32Array | Uint8Array | Uint16Array | Uint32Array>(
    value: Array | undefined,
  ): Array | undefined => value?.slice() as Array | undefined;
  const copyGeometry = (geometry: CpuGeometry): CpuGeometry => ({
    ...geometry,
    ...(geometry.colors === undefined ? {} : { colors: copyGeometryArray(geometry.colors)! }),
    ...(geometry.indices === undefined ? {} : { indices: copyGeometryArray(geometry.indices)! }),
    ...(geometry.normals === undefined ? {} : { normals: copyGeometryArray(geometry.normals)! }),
    positions: geometry.positions.slice(),
    ...(geometry.tangents === undefined ? {} : { tangents: copyGeometryArray(geometry.tangents)! }),
    ...(geometry.texCoords0 === undefined ? {} : { texCoords0: copyGeometryArray(geometry.texCoords0)! }),
    ...(geometry.texCoords1 === undefined ? {} : { texCoords1: copyGeometryArray(geometry.texCoords1)! }),
  });
  const copyTexture = <Texture extends TextureAssetRef | VirtualTextureAssetRef>(texture: Texture): Texture => ({
    ...texture,
    ...(texture.sampler === undefined ? {} : { sampler: { ...texture.sampler } }),
  }) as Texture;
  const copyGeometryDeclaration = (declaration: GeometryDeclaration): GeometryDeclaration => {
    if (declaration.kind === "direct-geometry") {
      return {
        ...declaration,
        geometry: {
          ...declaration.geometry,
          size: [...declaration.geometry.size],
        },
      } as GeometryDeclaration;
    }
    return {
      ...declaration,
      ...(declaration.colors === undefined ? {} : { colors: copyGeometryArray(declaration.colors)! }),
      ...(declaration.indices === undefined ? {} : { indices: copyGeometryArray(declaration.indices)! }),
      ...(declaration.normals === undefined ? {} : { normals: copyGeometryArray(declaration.normals)! }),
      positions: declaration.positions.slice(),
      ...(declaration.tangents === undefined ? {} : { tangents: copyGeometryArray(declaration.tangents)! }),
      ...(declaration.texCoords0 === undefined ? {} : { texCoords0: copyGeometryArray(declaration.texCoords0)! }),
      ...(declaration.texCoords1 === undefined ? {} : { texCoords1: copyGeometryArray(declaration.texCoords1)! }),
    };
  };
  const copySources = (sources: ReadonlyMap<string, ReadonlyMap<string, LoadedTextureSource>>) =>
    new Map([...sources].map(([key, rows]) => [key, new Map(rows)]));
  return {
    assetSources: copySources(state.assetSources),
    contentKeysByAsset: new Map(
      [...state.contentKeysByAsset].map(([key, rows]) => [key, new Map(rows)]),
    ),
    counters: { ...state.counters },
    geometries: new Map([...state.geometries].map(([key, row]) => [key, {
      ...row,
      declaration: copyGeometryDeclaration(row.declaration),
      recipe: copyGeometry(row.recipe),
    }])),
    gltfRequests: new Map([...state.gltfRequests].map(([key, row]) => [key, {
      count: row.count,
      generation: row.generation,
      key: row.key,
      plan: row.plan === undefined ? undefined : {
        ...row.plan,
        geometries: new Map([...row.plan.geometries].map(([entryKey, entry]) => [entryKey, {
          ...entry,
          declaration: copyGeometryDeclaration(entry.declaration),
        }])),
        iblKeys: row.plan.iblKeys.map((entry) => ({ ...entry })),
        ordinaryTextures: new Map(
          [...row.plan.ordinaryTextures].map(([entryKey, entry]) => [entryKey, {
            ...entry,
            texture: copyTexture(entry.texture),
          }]),
        ),
        virtualTextures: row.plan.virtualTextures.map((entry) => ({
          ...entry,
          texture: copyTexture(entry.texture),
        })),
      },
      sourceUri: row.sourceUri,
    }])),
    hdrReadyAssetCount: state.hdrReadyAssetCount,
    iblReferences: new Map(state.iblReferences),
    iblSources: copySources(state.iblSources),
    ordinaryTextures: new Map([...state.ordinaryTextures].map(([key, row]) => [key, {
      ...row,
      texture: copyTexture(row.texture),
    }])),
    pendingAssetKeySet: new Set(state.pendingAssetKeySet),
    preparedSources: new Map(
      [...state.preparedSources].map(([key, row]) => [key, {
        ...row,
        texture: copyTexture(row.texture),
      }]),
    ),
    sourceReferences: new Map(state.sourceReferences),
    virtualTextures: new Map([...state.virtualTextures].map(([key, row]) => [key, {
      ...row,
      texture: copyTexture(row.texture),
    }])),
  };
};

declare const resourceArenaAuthority: unique symbol;

/** Explicit authority token; only this module can inspect or mutate its state. */
export interface ResourceArena {
  readonly [resourceArenaAuthority]: "ResourceArena";
}

interface ResourceArenaState {
  readonly assetSources: ReadonlyMap<string, ReadonlyMap<string, LoadedTextureSource>>;
  readonly counters: ResourceArenaCounters;
  readonly contentKeysByAsset: ReadonlyMap<string, ReadonlyMap<string, TextureContentKey>>;
  readonly gltfRequests: Map<string, GltfRequestDeclaration>;
  readonly geometries: Map<string, MutableResourceArenaGeometryRow>;
  hdrReadyAssetCount: number;
  readonly imageAbortControllers: ReadonlyMap<string, AbortController>;
  readonly iblReferences: Map<string, number>;
  readonly iblSources: ReadonlyMap<string, ReadonlyMap<string, LoadedTextureSource>>;
  nextGeometryId: number;
  readonly ordinaryTextures: Map<string, TextureDeclaration<TextureAssetRef>>;
  readonly pendingAssetKeySet: Set<string>;
  readonly preparedAssets: PreparedGltfAssetStore;
  readonly preparedSources: ReadonlyMap<string, PreparedTextureSource>;
  readonly sourceReferences: ReadonlyMap<LoadedTextureSource, number>;
  readonly virtualTextures: Map<string, TextureDeclaration<VirtualTextureAssetRef>>;
  readonly wake: () => void;
}

type MutableResourceArenaGeometryRow = {
  assetReferences: number;
  readonly declaration: GeometryDeclaration;
  readonly id: number;
  readonly key: string;
  readonly recipe: CpuGeometry;
  sceneReferences: number;
};

export interface ResourceArenaChanges {
  readonly acquiredGeometryDeclarations: readonly {
    readonly id: number;
    readonly key: string;
    readonly recipe: CpuGeometry;
  }[];
  readonly acquiredGltfRequests: readonly CountedGltfRequest[];
  readonly releasedGltfKeys: readonly string[];
  readonly releasedGeometryDeclarations: readonly { readonly id: number; readonly key: string }[];
  readonly releasedIblKeys: readonly string[];
  readonly releasedOrdinaryTextureKeys: readonly string[];
  readonly releasedSources: readonly LoadedTextureSource[];
  readonly releasedVirtualTextureKeys: readonly string[];
}

type MutableResourceArenaChanges = {
  -readonly [Key in keyof ResourceArenaChanges]: Array<ResourceArenaChanges[Key][number]>;
};

export interface PreparedAssetArenaEvent {
  readonly snapshot: PreparedGltfAssetSnapshot;
}

const arenaImageAbortControllers = (arena: ResourceArena): Map<string, AbortController> => {
  return (arena as unknown as ResourceArenaState).imageAbortControllers as Map<string, AbortController>;
};
const arenaPreparedSources = (arena: ResourceArena): Map<string, PreparedTextureSource> => {
  return (arena as unknown as ResourceArenaState).preparedSources as Map<string, PreparedTextureSource>;
};
const arenaSourceReferences = (arena: ResourceArena): Map<LoadedTextureSource, number> =>
  (arena as unknown as ResourceArenaState).sourceReferences as Map<LoadedTextureSource, number>;
const arenaIblSources = (arena: ResourceArena): Map<string, Map<string, LoadedTextureSource>> =>
  (arena as unknown as ResourceArenaState).iblSources as Map<string, Map<string, LoadedTextureSource>>;
const arenaAssetSources = (arena: ResourceArena): Map<string, Map<string, LoadedTextureSource>> =>
  (arena as unknown as ResourceArenaState).assetSources as Map<string, Map<string, LoadedTextureSource>>;
const arenaContentKeys = (arena: ResourceArena): Map<string, Map<string, TextureContentKey>> =>
  (arena as unknown as ResourceArenaState).contentKeysByAsset as Map<string, Map<string, TextureContentKey>>;

const retainSource = (arena: ResourceArena, source: LoadedTextureSource): void => {
  const references = arenaSourceReferences(arena);
  references.set(source, (references.get(source) ?? 0) + 1);
};

const releaseSource = (arena: ResourceArena, source: LoadedTextureSource): boolean => {
  const references = arenaSourceReferences(arena);
  const previous = references.get(source);
  if (previous === undefined) throw new Error("resource arena source released before acquisition");
  const next = previous - 1;
  if (next > 0) {
    references.set(source, next);
    return false;
  }
  references.delete(source);
  return true;
};

const changes = (): MutableResourceArenaChanges => ({
  acquiredGeometryDeclarations: [],
  acquiredGltfRequests: [],
  releasedGltfKeys: [],
  releasedGeometryDeclarations: [],
  releasedIblKeys: [],
  releasedOrdinaryTextureKeys: [],
  releasedSources: [],
  releasedVirtualTextureKeys: [],
});

const finalizeChanges = (arena: ResourceArena, result: MutableResourceArenaChanges): ResourceArenaChanges => {
  const state = arena as unknown as ResourceArenaState;
  for (let index = result.releasedOrdinaryTextureKeys.length - 1; index >= 0; index -= 1) {
    if (state.ordinaryTextures.has(result.releasedOrdinaryTextureKeys[index]!)) {
      result.releasedOrdinaryTextureKeys.splice(index, 1);
    }
  }
  for (let index = result.releasedVirtualTextureKeys.length - 1; index >= 0; index -= 1) {
    if (state.virtualTextures.has(result.releasedVirtualTextureKeys[index]!)) {
      result.releasedVirtualTextureKeys.splice(index, 1);
    }
  }
  return result;
};

const positiveSafeCount = (count: number, label: string): void => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`resource arena ${label} count must be a positive safe integer`);
  }
};

const uniqueCountedKeys = <Entry extends { readonly count: number; readonly key: string }>(
  entries: readonly Entry[],
  label: string,
): Set<string> => {
  const keys = new Set<string>();
  for (const entry of entries) {
    positiveSafeCount(entry.count, label);
    if (keys.has(entry.key)) throw new Error(`resource arena ${label} contains duplicate key ${entry.key}`);
    keys.add(entry.key);
  }
  return keys;
};

const validateDependencyManifest = (
  manifest: PreparedAssetDependencyManifest,
  label: string,
): void => {
  uniqueCountedKeys(manifest.geometries, `${label} geometry manifest`);
  uniqueCountedKeys(manifest.iblKeys, `${label} IBL manifest`);
  uniqueCountedKeys(manifest.ordinaryTextures, `${label} ordinary-texture manifest`);
  uniqueCountedKeys(manifest.virtualTextures, `${label} virtual-texture manifest`);
};

const assertGeometryIdCapacity = (arena: ResourceArena, acquisitionCount: number): void => {
  if (acquisitionCount <= 0) return;
  const state = arena as unknown as ResourceArenaState;
  const remaining = MAX_RESOURCE_ID - state.nextGeometryId + 1;
  if (acquisitionCount > remaining) throw new Error("resource arena geometry ID space is exhausted");
};

const geometryAcquisitionCount = (
  arena: ResourceArena,
  transitions: readonly {
    readonly next: Iterable<CountedGeometryDeclaration>;
    readonly previous: Iterable<CountedGeometryDeclaration>;
  }[],
): number => {
  const state = arena as unknown as ResourceArenaState;
  const references = new Map<string, number>();
  const recipes = new Map<string, CpuGeometry>();
  const referenceCount = (key: string): number => {
    const cached = references.get(key);
    if (cached !== undefined) return cached;
    const geometry = state.geometries.get(key);
    const count = geometry === undefined ? 0 : geometry.assetReferences + geometry.sceneReferences;
    references.set(key, count);
    return count;
  };
  let acquisitions = 0;
  for (const transition of transitions) {
    const deltas = new Map<string, number>();
    for (const entry of transition.previous) deltas.set(entry.key, (deltas.get(entry.key) ?? 0) - entry.count);
    for (const entry of transition.next) {
      const candidate = normalizeGeometryDeclaration(entry.declaration);
      const previousReferences = referenceCount(entry.key);
      const retainedRecipe = recipes.get(entry.key) ?? state.geometries.get(entry.key)?.recipe;
      if (previousReferences > 0 && retainedRecipe !== undefined && !sameGeometryBytes(retainedRecipe, candidate)) {
        throw new Error(`resource arena geometry identity collision for ${entry.key}`);
      }
      if (previousReferences === 0) recipes.set(entry.key, candidate);
      else if (retainedRecipe !== undefined) recipes.set(entry.key, retainedRecipe);
      deltas.set(entry.key, (deltas.get(entry.key) ?? 0) + entry.count);
    }
    for (const [key, delta] of deltas) {
      const previous = referenceCount(key);
      const next = previous + delta;
      if (next < 0) throw new Error(`resource arena geometry ${key} has negative references`);
      if (previous === 0 && next > 0) acquisitions += 1;
      references.set(key, next);
      if (next === 0) recipes.delete(key);
    }
  }
  return acquisitions;
};

const adjustHdrReadyAssetCount = (arena: ResourceArena, delta: -1 | 1): void => {
  const state = arena as unknown as ResourceArenaState;
  const next = state.hdrReadyAssetCount + delta;
  if (next < 0) throw new Error("resource arena HDR-ready asset count became negative");
  state.hdrReadyAssetCount = next;
};

const EMPTY_CHANGES: ResourceArenaChanges = Object.freeze({
  acquiredGeometryDeclarations: Object.freeze([]),
  acquiredGltfRequests: Object.freeze([]),
  releasedGltfKeys: Object.freeze([]),
  releasedGeometryDeclarations: Object.freeze([]),
  releasedIblKeys: Object.freeze([]),
  releasedOrdinaryTextureKeys: Object.freeze([]),
  releasedSources: Object.freeze([]),
  releasedVirtualTextureKeys: Object.freeze([]),
});
const EMPTY_PREPARED_ASSET_EVENTS = Object.freeze({
  changes: EMPTY_CHANGES,
  events: Object.freeze([]) as readonly PreparedAssetArenaEvent[],
});

export const createResourceArena = (
  load: PrepareGltfAssetJob,
  wake: () => void,
): ResourceArena => {
  let arena: ResourceArenaState;
  // The subscription callback below is the sole wake path. Store-level change
  // notification would wake a second time for the same published revision.
  const preparedAssets = new PreparedGltfAssetStore(load, () => undefined);
  arena = {
    assetSources: new Map(),
    counters: {
      assetPlanCompiles: 0,
      preparedAssetAcquires: 0,
      preparedAssetEvents: 0,
      preparedAssetReleases: 0,
      preparedAssetUpdates: 0,
      sceneLeaseAcquires: 0,
      sceneLeaseReleases: 0,
    },
    contentKeysByAsset: new Map(),
    gltfRequests: new Map(),
    geometries: new Map(),
    hdrReadyAssetCount: 0,
    imageAbortControllers: new Map(),
    iblReferences: new Map(),
    iblSources: new Map(),
    nextGeometryId: 1,
    ordinaryTextures: new Map(),
    pendingAssetKeySet: new Set(),
    preparedAssets,
    preparedSources: new Map(),
    sourceReferences: new Map(),
    virtualTextures: new Map(),
    wake,
  };
  return arena as unknown as ResourceArena;
};

const enqueuePreparedAsset = (arena: ResourceArena, key: string): void => {
  const state = arena as unknown as ResourceArenaState;
  if (state.pendingAssetKeySet.has(key)) return;
  state.pendingAssetKeySet.add(key);
  state.wake();
};

const applyTextureSceneDelta = <Texture>(
  declarations: Map<string, TextureDeclaration<Texture>>,
  key: string,
  delta: number,
  texture: Texture,
  released: string[],
): void => {
  let declaration = declarations.get(key);
  if (declaration === undefined) {
    if (delta <= 0) throw new Error(`resource arena texture ${key} released before acquisition`);
    declaration = { assetReferences: 0, key, sceneReferences: 0, texture };
    declarations.set(key, declaration);
  }
  declaration.sceneReferences += delta;
  declaration.texture = texture;
  if (declaration.sceneReferences < 0) throw new Error(`resource arena texture ${key} has negative scene references`);
  if (declaration.sceneReferences + declaration.assetReferences === 0) {
    declarations.delete(key);
    released.push(key);
  }
};

const applyGeometrySceneDelta = (
  arena: ResourceArena,
  row: import("./frame-plan").CountedKeyDelta<CountedDirectGeometryDeclaration>,
  result: MutableResourceArenaChanges,
): void => {
  const arenaState = arena as unknown as ResourceArenaState;
  let geometry = arenaState.geometries.get(row.key);
  if (geometry === undefined) {
    if (row.delta <= 0) throw new Error(`resource arena geometry ${row.key} released before acquisition`);
    const id = claimMonotonicId(arenaState.nextGeometryId, MAX_RESOURCE_ID, "resource arena geometry");
    arenaState.nextGeometryId = id + 1;
    geometry = {
      assetReferences: 0,
      declaration: row.resource.declaration,
      id,
      key: row.key,
      recipe: normalizeGeometryDeclaration(row.resource.declaration),
      sceneReferences: 0,
    };
    arenaState.geometries.set(row.key, geometry);
    result.acquiredGeometryDeclarations.push({ id: geometry.id, key: geometry.key, recipe: geometry.recipe });
  }
  geometry.sceneReferences += row.delta;
  if (geometry.sceneReferences < 0) throw new Error(`resource arena geometry ${row.key} has negative scene references`);
  if (geometry.sceneReferences + geometry.assetReferences === 0) {
    arenaState.geometries.delete(row.key);
    result.releasedGeometryDeclarations.push({ id: geometry.id, key: row.key });
  }
};

export const applyResourceDelta = (
  arena: ResourceArena,
  delta: ResourceManifestDelta,
): ResourceArenaChanges => {
  const state = arena as unknown as ResourceArenaState;
  const validateCountedDelta = (
    key: string,
    label: string,
    deltaCount: number,
    nextCount: number,
    previousCount: number,
  ): void => {
    if (
      !Number.isSafeInteger(deltaCount)
      || deltaCount === 0
      || !Number.isSafeInteger(nextCount)
      || nextCount < 0
      || previousCount + deltaCount !== nextCount
    ) throw new Error(`resource arena ${label} ${key} has an invalid counted delta`);
  };
  const gltfKeys = new Set<string>();
  for (const row of delta.gltfRequests) {
    if (gltfKeys.has(row.key)) throw new Error(`resource arena glTF delta contains duplicate key ${row.key}`);
    gltfKeys.add(row.key);
    const retained = state.gltfRequests.get(row.key);
    validateCountedDelta(row.key, "glTF", row.delta, row.nextCount, retained?.count ?? 0);
    if (retained === undefined && row.delta < 0) {
      throw new Error(`resource arena glTF ${row.key} released before acquisition`);
    }
    if (retained !== undefined && retained.sourceUri !== row.resource.sourceUri) {
      throw new Error(`resource arena glTF identity collision for ${row.key}`);
    }
  }
  const directKeys = new Set<string>();
  let directGeometryAcquisitions = 0;
  for (const row of delta.directGeometries) {
    if (directKeys.has(row.key)) throw new Error(`resource arena direct geometry delta contains duplicate key ${row.key}`);
    directKeys.add(row.key);
    const geometry = state.geometries.get(row.key);
    validateCountedDelta(row.key, "direct geometry", row.delta, row.nextCount, geometry?.sceneReferences ?? 0);
    if (geometry === undefined) {
      if (row.delta < 0) throw new Error(`resource arena geometry ${row.key} released before acquisition`);
      directGeometryAcquisitions += 1;
    } else if (geometry.sceneReferences + row.delta < 0) {
      throw new Error(`resource arena geometry ${row.key} has negative scene references`);
    } else {
      const candidate = normalizeGeometryDeclaration(row.resource.declaration);
      if (!sameGeometryBytes(geometry.recipe, candidate)) {
        throw new Error(`resource arena geometry identity collision for ${row.key}`);
      }
    }
  }
  const validateTextureRows = <Texture>(
    rows: readonly import("./frame-plan").CountedKeyDelta<CountedTextureDeclaration<Texture>>[],
    retained: ReadonlyMap<string, TextureDeclaration<Texture>>,
    label: string,
  ): void => {
    const keys = new Set<string>();
    for (const row of rows) {
      if (keys.has(row.key)) throw new Error(`resource arena ${label} delta contains duplicate key ${row.key}`);
      keys.add(row.key);
      const previous = retained.get(row.key)?.sceneReferences ?? 0;
      validateCountedDelta(row.key, label, row.delta, row.nextCount, previous);
      if (previous === 0 && row.delta < 0) {
        throw new Error(`resource arena ${label} ${row.key} released before acquisition`);
      }
    }
  };
  validateTextureRows(delta.ordinaryTextures, state.ordinaryTextures, "ordinary texture");
  validateTextureRows(delta.virtualTextures, state.virtualTextures, "virtual texture");
  assertGeometryIdCapacity(arena, directGeometryAcquisitions);
  const result = changes();
  for (const row of delta.gltfRequests) {
    const request = row.resource;
    let declaration = state.gltfRequests.get(row.key);
    if (declaration === undefined) {
      if (row.delta <= 0) throw new Error(`resource arena glTF ${row.key} released before acquisition`);
      let subscription!: PreparedGltfAssetSubscription;
      subscription = state.preparedAssets.request(
        { key: row.key, src: request.sourceUri },
        () => enqueuePreparedAsset(arena, row.key),
      );
      declaration = {
        count: row.nextCount,
        generation: subscription.getSnapshot().generation,
        key: row.key,
        plan: undefined,
        sourceUri: request.sourceUri,
        subscription,
      };
      state.gltfRequests.set(row.key, declaration);
      state.counters.preparedAssetAcquires += 1;
      state.counters.sceneLeaseAcquires += row.nextCount;
      result.acquiredGltfRequests.push(request);
      continue;
    }
    state.counters.sceneLeaseAcquires += Math.max(0, row.delta);
    state.counters.sceneLeaseReleases += Math.max(0, -row.delta);
    declaration.count = row.nextCount;
    if (row.nextCount !== 0) continue;
    releaseAssetPlan(arena, declaration, result);
    releaseAssetSources(arena, declaration.key, result.releasedSources);
    declaration.subscription.release();
    state.gltfRequests.delete(row.key);
    arenaContentKeys(arena).delete(row.key);
    state.pendingAssetKeySet.delete(row.key);
    state.counters.preparedAssetReleases += 1;
    result.releasedGltfKeys.push(row.key);
  }
  for (const row of delta.directGeometries) {
    state.counters.sceneLeaseAcquires += Math.max(0, row.delta);
    state.counters.sceneLeaseReleases += Math.max(0, -row.delta);
    applyGeometrySceneDelta(arena, row, result);
  }
  for (const row of delta.ordinaryTextures) {
    state.counters.sceneLeaseAcquires += Math.max(0, row.delta);
    state.counters.sceneLeaseReleases += Math.max(0, -row.delta);
    applyTextureSceneDelta(
      state.ordinaryTextures, row.key, row.delta, row.resource.texture, result.releasedOrdinaryTextureKeys,
    );
  }
  for (const row of delta.virtualTextures) {
    state.counters.sceneLeaseAcquires += Math.max(0, row.delta);
    state.counters.sceneLeaseReleases += Math.max(0, -row.delta);
    applyTextureSceneDelta(
      state.virtualTextures, row.key, row.delta, row.resource.texture, result.releasedVirtualTextureKeys,
    );
  }
  return finalizeChanges(arena, result);
};

const applyAssetTextureDelta = <Texture extends TextureAssetRef | VirtualTextureAssetRef>(
  declarations: Map<string, TextureDeclaration<Texture>>,
  previous: Iterable<CountedTextureDeclaration<Texture>>,
  next: Iterable<CountedTextureDeclaration<Texture>>,
  released: string[],
): void => {
  const nextByKey = new Map<string, CountedTextureDeclaration<Texture>>();
  for (const entry of next) nextByKey.set(entry.key, entry);
  const seen = new Set<string>();
  for (const entry of previous) {
    const nextEntry = nextByKey.get(entry.key);
    const delta = (nextEntry?.count ?? 0) - entry.count;
    seen.add(entry.key);
    if (delta === 0) continue;
    const declaration = declarations.get(entry.key);
    if (declaration === undefined) throw new Error(`resource arena asset texture ${entry.key} is missing`);
    declaration.assetReferences += delta;
    if (declaration.assetReferences < 0) throw new Error(`resource arena texture ${entry.key} has negative asset references`);
    if (declaration.assetReferences + declaration.sceneReferences === 0) {
      declarations.delete(entry.key);
      released.push(entry.key);
    }
  }
  for (const entry of next) {
    if (seen.has(entry.key)) continue;
    const declaration = declarations.get(entry.key);
    if (declaration === undefined) {
      declarations.set(entry.key, {
        assetReferences: entry.count,
        key: entry.key,
        sceneReferences: 0,
        texture: entry.texture,
      });
    } else {
      declaration.assetReferences += entry.count;
      declaration.texture = entry.texture;
    }
  }
};

const applyAssetGeometryDelta = (
  arena: ResourceArena,
  previous: Iterable<CountedGeometryDeclaration>,
  next: Iterable<CountedGeometryDeclaration>,
  result: MutableResourceArenaChanges,
): void => {
  const arenaState = arena as unknown as ResourceArenaState;
  const previousEntries = [...previous];
  const nextEntries = [...next];
  const previousKeys = uniqueCountedKeys(previousEntries, "previous geometry manifest");
  uniqueCountedKeys(nextEntries, "next geometry manifest");
  const nextByKey = new Map<string, CountedGeometryDeclaration>();
  for (const entry of nextEntries) nextByKey.set(entry.key, entry);
  const normalizedNewRecipes = new Map<string, CpuGeometry>();
  for (const entry of previousEntries) {
    const nextEntry = nextByKey.get(entry.key);
    if (nextEntry === undefined || nextEntry.declaration === entry.declaration) continue;
    const retained = arenaState.geometries.get(entry.key);
    if (retained === undefined) throw new Error(`resource arena asset geometry ${entry.key} is missing`);
    const candidate = normalizeGeometryDeclaration(nextEntry.declaration);
    if (!sameGeometryBytes(retained.recipe, candidate)) {
      throw new Error(`resource arena geometry identity collision for ${entry.key}`);
    }
  }
  for (const entry of nextEntries) {
    if (previousKeys.has(entry.key)) continue;
    const candidate = normalizeGeometryDeclaration(entry.declaration);
    const retained = arenaState.geometries.get(entry.key);
    if (retained !== undefined && !sameGeometryBytes(retained.recipe, candidate)) {
      throw new Error(`resource arena geometry identity collision for ${entry.key}`);
    }
    normalizedNewRecipes.set(entry.key, candidate);
  }
  assertGeometryIdCapacity(arena, geometryAcquisitionCount(arena, [{ previous: previousEntries, next: nextEntries }]));
  const seen = new Set<string>();
  for (const entry of previousEntries) {
    const nextEntry = nextByKey.get(entry.key);
    const delta = (nextEntry?.count ?? 0) - entry.count;
    seen.add(entry.key);
    if (delta === 0) continue;
    const geometry = arenaState.geometries.get(entry.key);
    if (geometry === undefined) throw new Error(`resource arena asset geometry ${entry.key} is missing`);
    geometry.assetReferences += delta;
    if (geometry.assetReferences < 0) throw new Error(`resource arena geometry ${entry.key} has negative asset references`);
    if (geometry.assetReferences + geometry.sceneReferences === 0) {
      arenaState.geometries.delete(entry.key);
      result.releasedGeometryDeclarations.push({ id: geometry.id, key: entry.key });
    }
  }
  for (const entry of nextEntries) {
    if (seen.has(entry.key)) continue;
    const geometry = arenaState.geometries.get(entry.key);
    if (geometry === undefined) {
      const id = claimMonotonicId(arenaState.nextGeometryId, MAX_RESOURCE_ID, "resource arena geometry");
      arenaState.nextGeometryId = id + 1;
      const created: MutableResourceArenaGeometryRow = {
        assetReferences: entry.count,
        declaration: entry.declaration,
        id,
        key: entry.key,
        recipe: normalizedNewRecipes.get(entry.key)!,
        sceneReferences: 0,
      };
      arenaState.geometries.set(entry.key, created);
      result.acquiredGeometryDeclarations.push({ id: created.id, key: entry.key, recipe: created.recipe });
    } else {
      geometry.assetReferences += entry.count;
    }
  }
};

const applyAssetTextureReferenceDelta = <Texture extends TextureAssetRef | VirtualTextureAssetRef>(
  declarations: Map<string, TextureDeclaration<Texture>>,
  entry: CountedTextureDeclaration<Texture>,
  delta: number,
  released: string[],
): void => {
  const declaration = declarations.get(entry.key);
  if (declaration === undefined) {
    if (delta < 0) throw new Error(`resource arena asset texture ${entry.key} is missing`);
    declarations.set(entry.key, {
      assetReferences: delta,
      key: entry.key,
      sceneReferences: 0,
      texture: entry.texture,
    });
    return;
  }
  declaration.assetReferences += delta;
  declaration.texture = entry.texture;
  if (declaration.assetReferences < 0) {
    throw new Error(`resource arena texture ${entry.key} has negative asset references`);
  }
  if (declaration.assetReferences + declaration.sceneReferences === 0) {
    declarations.delete(entry.key);
    released.push(entry.key);
  }
};

const applyAssetIblDelta = (
  arena: ResourceArena,
  previous: readonly { readonly count: number; readonly key: string }[],
  next: readonly { readonly count: number; readonly key: string }[],
  result: MutableResourceArenaChanges,
): void => {
  const state = arena as unknown as ResourceArenaState;
  const nextCounts = new Map(next.map((entry) => [entry.key, entry.count]));
  const seen = new Set<string>();
  for (const entry of previous) {
    const nextCount = nextCounts.get(entry.key) ?? 0;
    seen.add(entry.key);
    const total = (state.iblReferences.get(entry.key) ?? 0) + nextCount - entry.count;
    if (total < 0) throw new Error(`resource arena IBL ${entry.key} has negative references`);
    if (total > 0) state.iblReferences.set(entry.key, total);
    else {
      state.iblReferences.delete(entry.key);
      result.releasedIblKeys.push(entry.key);
      const sources = arenaIblSources(arena).get(entry.key);
      arenaIblSources(arena).delete(entry.key);
      for (const source of sources?.values() ?? []) {
        if (releaseSource(arena, source)) result.releasedSources.push(source);
      }
    }
  }
  for (const entry of next) {
    if (seen.has(entry.key)) continue;
    state.iblReferences.set(entry.key, (state.iblReferences.get(entry.key) ?? 0) + entry.count);
  }
};

const releaseAssetPlan = (
  arena: ResourceArena,
  declaration: GltfRequestDeclaration,
  result: MutableResourceArenaChanges,
): void => {
  const state = arena as unknown as ResourceArenaState;
  const previous = declaration.plan;
  if (previous === undefined) return;
  if (previous.wantsHdr) adjustHdrReadyAssetCount(arena, -1);
  applyAssetIblDelta(arena, previous.iblKeys, [], result);
  applyAssetGeometryDelta(arena, previous.geometries.values(), [], result);
  applyAssetTextureDelta(state.ordinaryTextures, previous.ordinaryTextures.values(), [], result.releasedOrdinaryTextureKeys);
  applyAssetTextureDelta(state.virtualTextures, previous.virtualTextures, [], result.releasedVirtualTextureKeys);
  declaration.plan = undefined;
};

const releaseAssetSources = (
  arena: ResourceArena,
  assetKey: string,
  releasedSources: LoadedTextureSource[],
): void => {
  const sources = arenaAssetSources(arena).get(assetKey);
  arenaAssetSources(arena).delete(assetKey);
  for (const source of sources?.values() ?? []) {
    if (releaseSource(arena, source)) releasedSources.push(source);
  }
};

export const applyPreparedAssetEvents = (
  arena: ResourceArena,
  compileManifest: (
    asset: PreparedGltfAsset,
    contentKeys: ReadonlyMap<string, TextureContentKey>,
    assetKey: string,
  ) => PreparedAssetDependencyManifest,
): { readonly changes: ResourceArenaChanges; readonly events: readonly PreparedAssetArenaEvent[] } => {
  const state = arena as unknown as ResourceArenaState;
  if (state.pendingAssetKeySet.size === 0) return EMPTY_PREPARED_ASSET_EVENTS;
  const result = changes();
  const events: PreparedAssetArenaEvent[] = [];
  const pendingKeys = [...state.pendingAssetKeySet];
  const stagedEvents: PreparedAssetArenaEvent[] = [];
  const sourceRevisionUpdates: Array<{
    readonly declaration: GltfRequestDeclaration;
    readonly revision: number;
  }> = [];
  const planUpdates: Array<{
    readonly declaration: GltfRequestDeclaration;
    readonly manifest: PreparedAssetDependencyManifest;
    readonly snapshot: PreparedGltfAssetSnapshot & { readonly status: "ready" };
  }> = [];
  for (const key of pendingKeys) {
    const declaration = state.gltfRequests.get(key);
    if (declaration === undefined) continue;
    const snapshot = declaration.subscription.getSnapshot();
    if (snapshot.generation !== declaration.generation) continue;
    stagedEvents.push({ snapshot });
    if (snapshot.status !== "ready") continue;
    if (
      declaration.plan?.generation === snapshot.generation
      && declaration.plan.sourceRevision === snapshot.revision
    ) continue;
    if (declaration.plan?.generation === snapshot.generation && snapshot.asset.imagePreparation === undefined) {
      sourceRevisionUpdates.push({ declaration, revision: snapshot.revision });
      continue;
    }
    const manifest = compileManifest(snapshot.asset, state.contentKeysByAsset.get(key) ?? EMPTY_CONTENT_KEYS, key);
    validateDependencyManifest(manifest, `prepared asset ${key}`);
    planUpdates.push({ declaration, manifest, snapshot });
  }
  assertGeometryIdCapacity(arena, geometryAcquisitionCount(
    arena,
    planUpdates.map(({ declaration, manifest }) => ({
      next: manifest.geometries,
      previous: declaration.plan?.geometries.values() ?? [],
    })),
  ));

  for (const key of pendingKeys) state.pendingAssetKeySet.delete(key);
  for (const event of stagedEvents) {
    state.counters.preparedAssetEvents += 1;
    events.push(event);
  }
  for (const { declaration, revision } of sourceRevisionUpdates) {
    declaration.plan = { ...declaration.plan!, sourceRevision: revision };
  }
  for (const { declaration, manifest, snapshot } of planUpdates) {
    const previous = declaration.plan;
    applyAssetGeometryDelta(arena, previous?.geometries.values() ?? [], manifest.geometries, result);
    if ((previous?.wantsHdr ?? false) !== manifest.wantsHdr) {
      adjustHdrReadyAssetCount(arena, manifest.wantsHdr ? 1 : -1);
    }
    applyAssetIblDelta(arena, previous?.iblKeys ?? [], manifest.iblKeys, result);
    applyAssetTextureDelta(
      state.ordinaryTextures,
      previous?.ordinaryTextures.values() ?? [],
      manifest.ordinaryTextures,
      result.releasedOrdinaryTextureKeys,
    );
    applyAssetTextureDelta(
      state.virtualTextures,
      previous?.virtualTextures ?? [],
      manifest.virtualTextures,
      result.releasedVirtualTextureKeys,
    );
    declaration.plan = {
      dependencyRevision: (previous?.dependencyRevision ?? -1) + 1,
      generation: snapshot.generation,
      geometries: new Map(manifest.geometries.map((entry) => [entry.key, { ...entry }])),
      iblKeys: manifest.iblKeys,
      ordinaryTextures: new Map(manifest.ordinaryTextures.map((entry) => [entry.key, entry])),
      sourceRevision: snapshot.revision,
      virtualTextures: manifest.virtualTextures,
      wantsHdr: manifest.wantsHdr,
    };
    state.counters.assetPlanCompiles += 1;
    state.counters.preparedAssetUpdates += 1;
  }
  return { changes: finalizeChanges(arena, result), events };
};

const EMPTY_CONTENT_KEYS: ReadonlyMap<string, TextureContentKey> = new Map();

export const resourceArenaHasPendingAssetEvents = (arena: ResourceArena): boolean =>
  (arena as unknown as ResourceArenaState).pendingAssetKeySet.size !== 0;

export const resourceArenaHasHdrReadyAsset = (arena: ResourceArena): boolean =>
  (arena as unknown as ResourceArenaState).hdrReadyAssetCount > 0;

export const resourceArenaCountersSnapshot = (arena: ResourceArena): Readonly<ResourceArenaCounters> => ({
  ...(arena as unknown as ResourceArenaState).counters,
});

export const detachResourceArenaImagePreparation = (
  arena: ResourceArena,
  key: string,
  generation: number,
): void => {
  (arena as unknown as ResourceArenaState).preparedAssets.detachImagePreparation(key, generation);
};

export const resourceArenaOrdinaryTextureResidencySnapshot = (
  arena: ResourceArena,
): ResourceArenaOrdinaryTextureResidencySnapshot => {
  const ordinaryTextures = (arena as unknown as ResourceArenaState).ordinaryTextures;
  let activeReferences = 0;
  for (const declaration of ordinaryTextures.values()) {
    activeReferences += declaration.sceneReferences + declaration.assetReferences;
  }
  return { activeLeases: ordinaryTextures.size, activeReferences };
};

export const publishResourceArenaContentKey = (
  arena: ResourceArena,
  assetKey: string,
  textureUri: string,
  contentKey: TextureContentKey,
): void => {
  let keys = arenaContentKeys(arena).get(assetKey);
  if (keys === undefined) {
    keys = new Map();
    arenaContentKeys(arena).set(assetKey, keys);
  }
  keys.set(textureUri, contentKey);
};

export const resourceArenaContentKeys = (
  arena: ResourceArena,
  assetKey: string,
): ReadonlyMap<string, TextureContentKey> => new Map(
  (arena as unknown as ResourceArenaState).contentKeysByAsset.get(assetKey) ?? EMPTY_CONTENT_KEYS,
);

export const resourceArenaTextureReferenceCount = (arena: ResourceArena, key: string): number => {
  const ordinary = (arena as unknown as ResourceArenaState).ordinaryTextures.get(key);
  if (ordinary !== undefined) return ordinary.sceneReferences + ordinary.assetReferences;
  const virtual = (arena as unknown as ResourceArenaState).virtualTextures.get(key);
  return virtual === undefined ? 0 : virtual.sceneReferences + virtual.assetReferences;
};

export const replaceResourceArenaImageAbortController = (
  arena: ResourceArena,
  key: string,
): AbortController => {
  const controllers = arenaImageAbortControllers(arena);
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  return controller;
};

export const finishResourceArenaImageWork = (arena: ResourceArena, key: string): void => {
  arenaImageAbortControllers(arena).delete(key);
};

export const abortResourceArenaImageWork = (arena: ResourceArena, key: string): void => {
  const controllers = arenaImageAbortControllers(arena);
  controllers.get(key)?.abort();
  controllers.delete(key);
};

export const resourceArenaPreparedSource = (arena: ResourceArena, key: string): PreparedTextureSource | undefined =>
  arenaPreparedSources(arena).get(key);

export const retainResourceArenaPreparedSource = (
  arena: ResourceArena,
  key: string,
  source: PreparedTextureSource,
): PreparedTextureSource | undefined => {
  const sources = arenaPreparedSources(arena);
  const previous = sources.get(key);
  if (previous?.source !== source.source) {
    if (previous !== undefined) releaseSource(arena, previous.source);
    retainSource(arena, source.source);
  }
  sources.set(key, source);
  return previous;
};

export const releaseResourceArenaPreparedSource = (
  arena: ResourceArena,
  key: string,
): PreparedTextureSource | undefined => {
  const sources = arenaPreparedSources(arena);
  const source = sources.get(key);
  sources.delete(key);
  if (source !== undefined) releaseSource(arena, source.source);
  return source;
};

export const resourceArenaPreparedSourceValues = (arena: ResourceArena): IterableIterator<PreparedTextureSource> =>
  arenaPreparedSources(arena).values();

export const resourceArenaPreparedSourceKeys = (arena: ResourceArena): IterableIterator<string> =>
  arenaPreparedSources(arena).keys();

export const clearResourceArenaPreparedSources = (arena: ResourceArena): void => {
  const sources = arenaPreparedSources(arena);
  for (const source of sources.values()) releaseSource(arena, source.source);
  sources.clear();
};

export const resourceArenaSourceReferenceCount = (arena: ResourceArena, source: LoadedTextureSource): number =>
  (arena as unknown as ResourceArenaState).sourceReferences.get(source) ?? 0;

/**
 * Retains a decoded source for an owner whose lifetime is not represented by a
 * prepared texture, glTF asset, or IBL row. The token keeps that ownership
 * explicit without adding another keyed ownership table to the arena state.
 */
export const retainResourceArenaSourceLease = (
  arena: ResourceArena,
  source: LoadedTextureSource,
): ResourceArenaSourceLease => {
  retainSource(arena, source);
  let released = false;
  return {
    release: () => {
      if (released) return false;
      released = true;
      return releaseSource(arena, source);
    },
  };
};

export const retainResourceArenaAssetSource = (
  arena: ResourceArena,
  assetKey: string,
  sourceKey: string,
  source: LoadedTextureSource,
): LoadedTextureSource | undefined => {
  let sources = arenaAssetSources(arena).get(assetKey);
  if (sources === undefined) {
    sources = new Map();
    arenaAssetSources(arena).set(assetKey, sources);
  }
  const previous = sources.get(sourceKey);
  if (previous !== source) {
    if (previous !== undefined) releaseSource(arena, previous);
    retainSource(arena, source);
    sources.set(sourceKey, source);
  }
  return previous;
};

export const releaseResourceArenaAssetSource = (
  arena: ResourceArena,
  assetKey: string,
  sourceKey: string,
): LoadedTextureSource | undefined => {
  const sources = arenaAssetSources(arena).get(assetKey);
  const source = sources?.get(sourceKey);
  if (source === undefined) return undefined;
  sources!.delete(sourceKey);
  if (sources!.size === 0) arenaAssetSources(arena).delete(assetKey);
  releaseSource(arena, source);
  return source;
};

export const retainResourceArenaIblSource = (
  arena: ResourceArena,
  iblKey: string,
  sourceKey: string,
  source: LoadedTextureSource,
): LoadedTextureSource | undefined => {
  const allSources = arenaIblSources(arena);
  let sources = allSources.get(iblKey);
  if (sources === undefined) {
    sources = new Map();
    allSources.set(iblKey, sources);
  }
  const previous = sources.get(sourceKey);
  if (previous !== source) {
    if (previous !== undefined) releaseSource(arena, previous);
    retainSource(arena, source);
    sources.set(sourceKey, source);
  }
  return previous;
};

export const copyResourceArenaIblSources = (
  arena: ResourceArena,
  iblKey: string,
  target: Map<string, LoadedTextureSource>,
): boolean => {
  const state = arena as unknown as ResourceArenaState;
  const sources = state.iblSources.get(iblKey);
  if (sources === undefined) return false;
  for (const [key, source] of sources) target.set(key, source);
  return true;
};

export const resourceArenaIblSourceCount = (arena: ResourceArena, iblKey: string): number => {
  const state = arena as unknown as ResourceArenaState;
  return state.iblSources.get(iblKey)?.size ?? 0;
};

export const updatePreparedAssetManifest = (
  arena: ResourceArena,
  key: string,
  manifest: PreparedAssetDependencyManifest,
): ResourceArenaChanges => {
  const state = arena as unknown as ResourceArenaState;
  const result = changes();
  const declaration = state.gltfRequests.get(key);
  if (declaration === undefined || declaration.plan === undefined) return result;
  validateDependencyManifest(manifest, `prepared asset ${key}`);
  assertGeometryIdCapacity(arena, geometryAcquisitionCount(arena, [{
    next: manifest.geometries,
    previous: declaration.plan.geometries.values(),
  }]));
  applyAssetGeometryDelta(
    arena,
    declaration.plan.geometries.values(),
    manifest.geometries,
    result,
  );
  if (declaration.plan.wantsHdr !== manifest.wantsHdr) {
    adjustHdrReadyAssetCount(arena, manifest.wantsHdr ? 1 : -1);
  }
  applyAssetTextureDelta(
    state.ordinaryTextures,
    declaration.plan.ordinaryTextures.values(),
    manifest.ordinaryTextures,
    result.releasedOrdinaryTextureKeys,
  );
  applyAssetIblDelta(arena, declaration.plan.iblKeys, manifest.iblKeys, result);
  applyAssetTextureDelta(
    state.virtualTextures,
    declaration.plan.virtualTextures,
    manifest.virtualTextures,
    result.releasedVirtualTextureKeys,
  );
  declaration.plan = {
    dependencyRevision: declaration.plan.dependencyRevision + 1,
    generation: declaration.plan.generation,
    geometries: new Map(manifest.geometries.map((entry) => [entry.key, { ...entry }])),
    iblKeys: manifest.iblKeys,
    ordinaryTextures: new Map(manifest.ordinaryTextures.map((entry) => [entry.key, entry])),
    sourceRevision: declaration.plan.sourceRevision,
    virtualTextures: manifest.virtualTextures,
    wantsHdr: manifest.wantsHdr,
  };
  state.counters.assetPlanCompiles += 1;
  state.counters.preparedAssetUpdates += 1;
  return finalizeChanges(arena, result);
};

/** Applies a decoded-image cohort without recompiling every material texture slot in the asset. */
export const rekeyPreparedAssetOrdinaryTextures = (
  arena: ResourceArena,
  key: string,
  rekeys: readonly PreparedAssetOrdinaryTextureRekey[],
): ResourceArenaChanges => {
  if (rekeys.length === 0) return EMPTY_CHANGES;
  const state = arena as unknown as ResourceArenaState;
  const declaration = state.gltfRequests.get(key);
  const plan = declaration?.plan;
  if (plan === undefined) return EMPTY_CHANGES;

  const released: string[] = [];
  const previousCounts = new Map<string, number>();
  for (const rekey of rekeys) {
    if (
      !Number.isSafeInteger(rekey.previous.count)
      || rekey.previous.count <= 0
      || rekey.next.count !== rekey.previous.count
      || rekey.previous.key === rekey.next.key
    ) throw new Error("resource arena texture rekey must have equal positive counts and distinct keys");
    previousCounts.set(
      rekey.previous.key,
      (previousCounts.get(rekey.previous.key) ?? 0) + rekey.previous.count,
    );
  }
  for (const [previousKey, count] of previousCounts) {
    if ((plan.ordinaryTextures.get(previousKey)?.count ?? 0) < count) {
      throw new Error(`resource arena asset texture ${previousKey} rekey exceeds retained references`);
    }
  }

  for (const { next, previous } of rekeys) {
    const previousEntry = plan.ordinaryTextures.get(previous.key)!;
    const previousCount = previousEntry.count - previous.count;
    if (previousCount === 0) plan.ordinaryTextures.delete(previous.key);
    else previousEntry.count = previousCount;
    const nextEntry = plan.ordinaryTextures.get(next.key);
    if (nextEntry === undefined) plan.ordinaryTextures.set(next.key, { ...next });
    else nextEntry.count += next.count;

    applyAssetTextureReferenceDelta(state.ordinaryTextures, previous, -previous.count, released);
    applyAssetTextureReferenceDelta(state.ordinaryTextures, next, next.count, released);
  }
  plan.dependencyRevision += 1;
  state.counters.preparedAssetUpdates += 1;
  return finalizeChanges(arena, { ...changes(), releasedOrdinaryTextureKeys: released });
};

export const disposeResourceArena = (arena: ResourceArena): ResourceArenaChanges => {
  const state = arena as unknown as ResourceArenaState;
  const result = changes();
  for (const declaration of state.gltfRequests.values()) {
    state.counters.sceneLeaseReleases += declaration.count;
    state.counters.preparedAssetReleases += 1;
    releaseAssetPlan(arena, declaration, result);
    releaseAssetSources(arena, declaration.key, result.releasedSources);
    declaration.subscription.release();
    result.releasedGltfKeys.push(declaration.key);
  }
  for (const key of state.ordinaryTextures.keys()) result.releasedOrdinaryTextureKeys.push(key);
  for (const key of state.virtualTextures.keys()) result.releasedVirtualTextureKeys.push(key);
  for (const [key, geometry] of state.geometries) {
    state.counters.sceneLeaseReleases += geometry.sceneReferences;
    result.releasedGeometryDeclarations.push({ id: geometry.id, key });
  }
  state.geometries.clear();
  state.gltfRequests.clear();
  arenaContentKeys(arena).clear();
  state.hdrReadyAssetCount = 0;
  for (const [assetKey] of arenaAssetSources(arena)) {
    releaseAssetSources(arena, assetKey, result.releasedSources);
  }
  const preparedSources = arenaPreparedSources(arena);
  for (const prepared of preparedSources.values()) {
    if (releaseSource(arena, prepared.source)) result.releasedSources.push(prepared.source);
  }
  preparedSources.clear();
  for (const [iblKey, sources] of arenaIblSources(arena)) {
    result.releasedIblKeys.push(iblKey);
    for (const source of sources.values()) {
      if (releaseSource(arena, source)) result.releasedSources.push(source);
    }
  }
  arenaIblSources(arena).clear();
  state.iblReferences.clear();
  if (state.sourceReferences.size !== 0) {
    throw new Error("resource arena disposed with unowned source references");
  }
  const controllers = arenaImageAbortControllers(arena);
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  for (const declaration of state.ordinaryTextures.values()) {
    state.counters.sceneLeaseReleases += declaration.sceneReferences;
  }
  for (const declaration of state.virtualTextures.values()) {
    state.counters.sceneLeaseReleases += declaration.sceneReferences;
  }
  state.ordinaryTextures.clear();
  state.virtualTextures.clear();
  state.pendingAssetKeySet.clear();
  state.preparedAssets.dispose();
  return result;
};
