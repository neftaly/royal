import type {
  GltfMaterialPrimitiveLod,
  GltfNodePrimitiveLod,
  LoadedGltfPrimitive,
} from "./prepared-asset";
import {
  beginSharedViewLodSelections,
  createSharedViewLodSelections,
  finalizeSharedViewLodSelection,
  finalizeUnobservedSharedViewLodFallback,
  NO_SHARED_VIEW_LOD_LEVEL,
  observeSharedViewLodCoverage,
  reserveSharedViewLodSelections,
  sharedViewLodSelectedLevel,
  sharedViewLodWasObserved,
  validateSharedViewLodMetadata,
  type SharedViewLodMetadata,
  type SharedViewLodSelections,
} from "./shared-view-lod-selection";

type AssetSelections = {
  readonly ids: number[];
  readonly materialMetadata: Map<string, SharedViewLodMetadata>;
  readonly nodeMetadata: Map<string, SharedViewLodMetadata>;
  readonly selectionIds: Map<string, number>;
};

export type GltfSharedViewLodAssetReplacement = {
  readonly assetKey: string;
  readonly serial: number;
};

export type GltfSharedViewLodRegistrySnapshot = {
  readonly activeMetadata: number;
  readonly activeSelections: number;
  readonly capacity: number;
  readonly epoch: number;
  readonly freeSelections: number;
  readonly reservedSelections: number;
};

export type GltfSharedViewLodPacketSelections = {
  readonly epoch: number;
  readonly selectedLevels: Uint32Array;
  readonly selectionEpochs: Uint32Array;
};

type ActiveReplacement = {
  readonly asset: AssetSelections;
  readonly token: GltfSharedViewLodAssetReplacement;
};

const createAssetSelections = (): AssetSelections => ({
  ids: [],
  materialMetadata: new Map(),
  nodeMetadata: new Map(),
  selectionIds: new Map(),
});

/**
 * Owns the retained shared-view LOD registry and its allocation-free frame
 * observation state. Projection and scene traversal deliberately remain in
 * the renderer root.
 */
export class GltfSharedViewLodRegistry {
  #activeReplacement: ActiveReplacement | undefined;
  readonly #assets = new Map<string, AssetSelections>();
  #freeIds: number[] = [];
  #materialIds = new Uint32Array(1);
  #materialCount = 0;
  #metadataById: Array<SharedViewLodMetadata | undefined> = [];
  #nextId = 0;
  #nodeFallbackEpochs = new Uint32Array(1);
  #nodeFallbackLevels = new Uint32Array(1);
  #nodeIds = new Uint32Array(1);
  #nodeCount = 0;
  #replacementSerial = 0;
  #selections: SharedViewLodSelections = createSharedViewLodSelections();
  #touchEpochs = new Uint32Array(1);
  #touchPhases = new Uint8Array(1);

  get packetSelections(): GltfSharedViewLodPacketSelections {
    return this.#selections;
  }

  resetPlan(): void {
    this.#activeReplacement = undefined;
    this.#assets.clear();
    this.#freeIds = [];
    this.#materialIds = new Uint32Array(1);
    this.#materialCount = 0;
    this.#metadataById = [];
    this.#nextId = 0;
    this.#nodeFallbackEpochs = new Uint32Array(1);
    this.#nodeFallbackLevels = new Uint32Array(1);
    this.#nodeIds = new Uint32Array(1);
    this.#nodeCount = 0;
    this.#selections = createSharedViewLodSelections();
    this.#touchEpochs = new Uint32Array(1);
    this.#touchPhases = new Uint8Array(1);
  }

  beginAssetReplacement(assetKey: string): GltfSharedViewLodAssetReplacement {
    if (this.#activeReplacement !== undefined) {
      throw new Error("Royal shared-view LOD asset replacement is already active");
    }
    this.#replacementSerial += 1;
    if (!Number.isSafeInteger(this.#replacementSerial)) {
      throw new Error("Royal shared-view LOD replacement serial space is exhausted");
    }
    const token = { assetKey, serial: this.#replacementSerial };
    this.#activeReplacement = { asset: createAssetSelections(), token };
    return token;
  }

  commitAssetReplacement(token: GltfSharedViewLodAssetReplacement): void {
    const replacement = this.#replacement(token);
    const previous = this.#assets.get(token.assetKey);
    this.#assets.set(token.assetKey, replacement.asset);
    this.#activeReplacement = undefined;
    if (previous !== undefined) this.#releaseAssetSelections(previous);
  }

  rollbackAssetReplacement(token: GltfSharedViewLodAssetReplacement): void {
    const replacement = this.#replacement(token);
    this.#activeReplacement = undefined;
    this.#releaseAssetSelections(replacement.asset);
  }

  beginFrame(): number {
    if (this.#activeReplacement !== undefined) {
      throw new Error("Royal shared-view LOD frame cannot begin during asset replacement");
    }
    const previousEpoch = this.#selections.epoch;
    const epoch = beginSharedViewLodSelections(this.#selections);
    if (epoch <= previousEpoch) {
      this.#touchEpochs.fill(0);
      this.#touchPhases.fill(0);
      this.#nodeFallbackEpochs.fill(0);
    }
    this.#nodeCount = 0;
    this.#materialCount = 0;
    return epoch;
  }

  nodeSelectionId(
    assetKey: string,
    selectionKey: string,
    lod: GltfNodePrimitiveLod,
    primitives: readonly LoadedGltfPrimitive[],
  ): number {
    const asset = this.#assetForWrite(assetKey);
    const metadataKey = `node:${lod.group}`;
    let metadata = asset.nodeMetadata.get(metadataKey);
    if (metadata === undefined) {
      const drawableLevels = new Uint8Array(lod.levelCount);
      for (const primitive of primitives) {
        if (primitive.nodeLod?.group === lod.group) drawableLevels[primitive.nodeLod.level] = 1;
      }
      metadata = validateSharedViewLodMetadata({
        drawableLevels,
        levelCount: lod.levelCount,
        offset: 0,
        thresholds: Float64Array.from(lod.thresholds),
      });
      asset.nodeMetadata.set(metadataKey, metadata);
    }
    return this.#selectionId(asset, selectionKey, metadata);
  }

  materialSelectionId(
    assetKey: string,
    selectionKey: string,
    lod: GltfMaterialPrimitiveLod,
  ): number {
    const asset = this.#assetForWrite(assetKey);
    const metadataKey = `${lod.thresholds.join(",")}:${lod.levels.length}`;
    let metadata = asset.materialMetadata.get(metadataKey);
    if (metadata === undefined) {
      metadata = validateSharedViewLodMetadata({
        drawableLevels: new Uint8Array(lod.levels.length).fill(1),
        levelCount: lod.levels.length,
        offset: 0,
        thresholds: Float64Array.from(lod.thresholds),
      });
      asset.materialMetadata.set(metadataKey, metadata);
    }
    return this.#selectionId(asset, selectionKey, metadata);
  }

  touchNode(id: number): void {
    this.#touch(id, 1);
  }

  observeNodeFallback(id: number, level: number): void {
    this.#metadata(id);
    const epoch = this.#selections.epoch;
    if (this.#nodeFallbackEpochs[id] !== epoch) {
      this.#nodeFallbackEpochs[id] = epoch;
      this.#nodeFallbackLevels[id] = level;
      return;
    }
    if (level < this.#nodeFallbackLevels[id]!) this.#nodeFallbackLevels[id] = level;
  }

  observeCoverage(id: number, coverage: number): void {
    this.#metadata(id);
    observeSharedViewLodCoverage(this.#selections, id, coverage);
  }

  finalizeNodes(): void {
    const epoch = this.#selections.epoch;
    for (let index = 0; index < this.#nodeCount; index += 1) {
      const id = this.#nodeIds[index]!;
      const metadata = this.#metadata(id);
      if (!sharedViewLodWasObserved(this.#selections, id) && this.#nodeFallbackEpochs[id] === epoch) {
        finalizeUnobservedSharedViewLodFallback(
          this.#selections,
          id,
          metadata,
          this.#nodeFallbackLevels[id]!,
        );
      } else {
        finalizeSharedViewLodSelection(this.#selections, id, metadata);
      }
    }
  }

  touchMaterial(id: number): void {
    this.#touch(id, 2);
  }

  finalizeMaterials(): void {
    for (let index = 0; index < this.#materialCount; index += 1) {
      const id = this.#materialIds[index]!;
      finalizeSharedViewLodSelection(this.#selections, id, this.#metadata(id));
    }
  }

  selectedLevel(assetKey: string, selectionKey: string): number | undefined {
    const id = this.#assets.get(assetKey)?.selectionIds.get(selectionKey);
    return id === undefined ? undefined : sharedViewLodSelectedLevel(this.#selections, id);
  }

  snapshot(): GltfSharedViewLodRegistrySnapshot {
    let activeMetadata = 0;
    let activeSelections = 0;
    for (const asset of this.#assets.values()) {
      activeMetadata += asset.materialMetadata.size + asset.nodeMetadata.size;
      activeSelections += asset.ids.length;
    }
    return {
      activeMetadata,
      activeSelections,
      capacity: this.#selections.capacity,
      epoch: this.#selections.epoch,
      freeSelections: this.#freeIds.length,
      reservedSelections: this.#nextId,
    };
  }

  #replacement(token: GltfSharedViewLodAssetReplacement): ActiveReplacement {
    if (this.#activeReplacement?.token !== token) {
      throw new Error("Royal shared-view LOD asset replacement token is not active");
    }
    return this.#activeReplacement;
  }

  #assetForWrite(assetKey: string): AssetSelections {
    if (this.#activeReplacement !== undefined) {
      if (this.#activeReplacement.token.assetKey !== assetKey) {
        throw new Error("Royal shared-view LOD replacement cannot mutate another asset");
      }
      return this.#activeReplacement.asset;
    }
    let asset = this.#assets.get(assetKey);
    if (asset === undefined) {
      asset = createAssetSelections();
      this.#assets.set(assetKey, asset);
    }
    return asset;
  }

  #selectionId(asset: AssetSelections, selectionKey: string, metadata: SharedViewLodMetadata): number {
    const existing = asset.selectionIds.get(selectionKey);
    if (existing !== undefined) return existing;
    const id = this.#freeIds.pop() ?? this.#nextId++;
    if (!Number.isSafeInteger(this.#nextId) || id >= 0xffff_ffff) {
      throw new Error("Royal shared-view LOD selection ID space is exhausted");
    }
    reserveSharedViewLodSelections(this.#selections, id + 1);
    this.#reserveScratch(id + 1);
    asset.ids.push(id);
    asset.selectionIds.set(selectionKey, id);
    this.#metadataById[id] = metadata;
    return id;
  }

  #releaseAssetSelections(asset: AssetSelections): void {
    for (const id of asset.ids) {
      this.#metadataById[id] = undefined;
      this.#selections.finalizationEpochs[id] = 0;
      this.#selections.maximumCoverages[id] = 0;
      this.#selections.observationEpochs[id] = 0;
      this.#selections.selectionEpochs[id] = 0;
      this.#selections.selectedLevels[id] = NO_SHARED_VIEW_LOD_LEVEL;
      this.#touchEpochs[id] = 0;
      this.#touchPhases[id] = 0;
      this.#nodeFallbackEpochs[id] = 0;
      this.#nodeFallbackLevels[id] = 0;
      this.#freeIds.push(id);
    }
  }

  #metadata(id: number): SharedViewLodMetadata {
    if (!Number.isSafeInteger(id) || id < 0 || id >= this.#nextId) {
      throw new Error("Royal shared-view LOD selection ID is invalid");
    }
    const metadata = this.#metadataById[id];
    if (metadata === undefined) throw new Error("Royal shared-view LOD selection is not active");
    return metadata;
  }

  #touch(id: number, phase: 1 | 2): void {
    this.#metadata(id);
    const epoch = this.#selections.epoch;
    if (epoch === 0) throw new Error("Royal shared-view LOD touch requires an active frame");
    if (this.#touchEpochs[id] === epoch && this.#touchPhases[id] === phase) return;
    this.#touchEpochs[id] = epoch;
    this.#touchPhases[id] = phase;
    if (phase === 1) {
      this.#nodeIds[this.#nodeCount] = id;
      this.#nodeCount += 1;
    } else {
      this.#materialIds[this.#materialCount] = id;
      this.#materialCount += 1;
    }
  }

  #reserveScratch(minimumCapacity: number): void {
    if (minimumCapacity <= this.#touchEpochs.length) return;
    const capacity = this.#selections.capacity;
    const touchEpochs = new Uint32Array(capacity);
    touchEpochs.set(this.#touchEpochs);
    this.#touchEpochs = touchEpochs;
    const touchPhases = new Uint8Array(capacity);
    touchPhases.set(this.#touchPhases);
    this.#touchPhases = touchPhases;
    const fallbackEpochs = new Uint32Array(capacity);
    fallbackEpochs.set(this.#nodeFallbackEpochs);
    this.#nodeFallbackEpochs = fallbackEpochs;
    const fallbackLevels = new Uint32Array(capacity);
    fallbackLevels.set(this.#nodeFallbackLevels);
    this.#nodeFallbackLevels = fallbackLevels;
    const nodeIds = new Uint32Array(capacity);
    nodeIds.set(this.#nodeIds);
    this.#nodeIds = nodeIds;
    const materialIds = new Uint32Array(capacity);
    materialIds.set(this.#materialIds);
    this.#materialIds = materialIds;
  }
}
