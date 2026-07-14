import type {
  GltfInstanceTransforms,
  PickingId,
  RenderNode,
  RenderObjectRef,
  RenderRoot,
  TextureAssetRef,
  TextureRef,
  VirtualTextureAssetRef,
} from "@royal/renderer-core";
import {
  directGeometryDeclaration,
  directGeometryDeclarationKey,
  type DirectGeometryDeclaration,
} from "./geometry-recipes";
import { textureCacheKey } from "./webgl/materials";

export type FramePlanNodeKind = RenderNode["kind"];
export type FramePlanLightNode = Extract<
  RenderNode,
  { readonly kind: "directional-light" | "point-light" | "spot-light" }
>;

export interface FramePlanRenderObjectRefRow {
  readonly nodeIndex: number;
  readonly ref: RenderObjectRef;
}

export interface FramePlanBulkInstanceRow {
  readonly nodeIndex: number;
  readonly source: GltfInstanceTransforms;
}

export interface FramePlanGltfRequestRow {
  readonly nodeIndex: number;
  readonly occurrenceIndex: number;
  readonly requestKey: string;
  readonly sourceUri: string;
}

export interface FramePlanDirectTextureRow {
  readonly key: string;
  readonly nodeIndex: number;
  readonly slot: string;
  readonly texture: TextureAssetRef | VirtualTextureAssetRef;
}

export interface CountedGltfRequest {
  readonly count: number;
  readonly key: string;
  readonly sourceUri: string;
  readonly version?: number | string;
}

export interface CountedDirectGeometryDeclaration {
  readonly count: number;
  readonly declaration: DirectGeometryDeclaration;
  readonly key: string;
}

export interface CountedTextureDeclaration<Texture extends TextureAssetRef | VirtualTextureAssetRef> {
  readonly count: number;
  readonly key: string;
  readonly texture: Texture;
}

export interface CountedReference<Resource> {
  readonly count: number;
  readonly resource: Resource;
}

export interface FramePlanResourceManifest {
  readonly bulkInstances: readonly CountedReference<GltfInstanceTransforms>[];
  readonly directGeometries: readonly CountedDirectGeometryDeclaration[];
  readonly gltfRequests: readonly CountedGltfRequest[];
  readonly ordinaryTextures: readonly CountedTextureDeclaration<TextureAssetRef>[];
  readonly renderObjectRefs: readonly CountedReference<RenderObjectRef>[];
  readonly virtualTextures: readonly CountedTextureDeclaration<VirtualTextureAssetRef>[];
}

export interface FramePlan {
  readonly bulkInstanceRows: readonly FramePlanBulkInstanceRow[];
  readonly camera: RenderRoot["camera"];
  readonly clearColor: RenderRoot["clearColor"];
  readonly directTextureRows: readonly FramePlanDirectTextureRow[];
  readonly environment: RenderRoot["environment"];
  readonly exposureEv100: RenderRoot["exposureEv100"];
  readonly gltfRequestRows: readonly FramePlanGltfRequestRow[];
  readonly lightNodeIndices: readonly number[];
  readonly lightNodes: readonly FramePlanLightNode[];
  readonly manifest: FramePlanResourceManifest;
  readonly nodeKinds: readonly FramePlanNodeKind[];
  readonly nodes: readonly RenderNode[];
  readonly occurrenceIndices: readonly number[];
  readonly orderSegments: readonly number[];
  readonly pickingIds: readonly (PickingId | undefined)[];
  readonly renderObjectRefRows: readonly FramePlanRenderObjectRefRow[];
  readonly revision: number;
  readonly scene: RenderRoot;
  readonly toneMapping: RenderRoot["toneMapping"];
}

export interface CountedKeyDelta<Resource> {
  readonly delta: number;
  readonly key: string;
  readonly nextCount: number;
  readonly previousCount: number;
  readonly resource: Resource;
}

export interface CountedReferenceDelta<Resource> {
  readonly delta: number;
  readonly nextCount: number;
  readonly previousCount: number;
  readonly resource: Resource;
}

export interface ResourceManifestDelta {
  readonly bulkInstances: readonly CountedReferenceDelta<GltfInstanceTransforms>[];
  readonly directGeometries: readonly CountedKeyDelta<CountedDirectGeometryDeclaration>[];
  readonly gltfRequests: readonly CountedKeyDelta<CountedGltfRequest>[];
  readonly ordinaryTextures: readonly CountedKeyDelta<CountedTextureDeclaration<TextureAssetRef>>[];
  readonly renderObjectRefs: readonly CountedReferenceDelta<RenderObjectRef>[];
  readonly virtualTextures: readonly CountedKeyDelta<CountedTextureDeclaration<VirtualTextureAssetRef>>[];
}

export interface ResourceManifestDiffScratch {
  readonly delta: ResourceManifestDelta;
  readonly nextByKey: Map<string, unknown>;
  readonly nextByReference: Map<unknown, number>;
  readonly rowPools: {
    readonly bulkInstances: Array<CountedReferenceDelta<GltfInstanceTransforms>>;
    readonly directGeometries: Array<CountedKeyDelta<CountedDirectGeometryDeclaration>>;
    readonly gltfRequests: Array<CountedKeyDelta<CountedGltfRequest>>;
    readonly ordinaryTextures: Array<CountedKeyDelta<CountedTextureDeclaration<TextureAssetRef>>>;
    readonly renderObjectRefs: Array<CountedReferenceDelta<RenderObjectRef>>;
    readonly virtualTextures: Array<CountedKeyDelta<CountedTextureDeclaration<VirtualTextureAssetRef>>>;
  };
  readonly seenKeys: Set<string>;
  readonly seenReferences: Set<unknown>;
}

export const gltfRequestKey = (sourceUri: string, version: string | number | undefined): string =>
  JSON.stringify(["gltf-source-v1", sourceUri, version ?? null]);

const isDirectTexture = (value: unknown): value is TextureAssetRef | VirtualTextureAssetRef =>
  typeof value === "object"
  && value !== null
  && (Reflect.get(value, "kind") === "asset" || Reflect.get(value, "kind") === "virtual-asset");

const incrementKey = <Entry extends { count: number; readonly key: string }>(
  byKey: Map<string, Entry>,
  entries: Entry[],
  key: string,
  create: () => Entry,
): void => {
  const entry = byKey.get(key);
  if (entry === undefined) {
    const next = create();
    byKey.set(key, next);
    entries.push(next);
  } else {
    entry.count += 1;
  }
};

const incrementReference = <Resource>(
  counts: Map<Resource, CountedReference<Resource> & { count: number }>,
  entries: Array<CountedReference<Resource> & { count: number }>,
  resource: Resource,
): void => {
  const entry = counts.get(resource);
  if (entry === undefined) {
    const next = { count: 1, resource };
    counts.set(resource, next);
    entries.push(next);
  } else {
    entry.count += 1;
  }
};

const directTextures = (
  node: RenderNode,
  nodeIndex: number,
  rows: FramePlanDirectTextureRow[],
  ordinaryByKey: Map<string, CountedTextureDeclaration<TextureAssetRef> & { count: number }>,
  ordinary: Array<CountedTextureDeclaration<TextureAssetRef> & { count: number }>,
  virtualByKey: Map<string, CountedTextureDeclaration<VirtualTextureAssetRef> & { count: number }>,
  virtualTextures: Array<CountedTextureDeclaration<VirtualTextureAssetRef> & { count: number }>,
): void => {
  if (node.kind !== "mesh") return;
  for (const [slot, value] of Object.entries(node.material)) {
    if (!isDirectTexture(value)) continue;
    const key = textureCacheKey(value as TextureRef);
    rows.push({ key, nodeIndex, slot, texture: value });
    if (value.kind === "asset") {
      incrementKey(ordinaryByKey, ordinary, key, () => ({ count: 1, key, texture: value }));
    } else {
      incrementKey(virtualByKey, virtualTextures, key, () => ({ count: 1, key, texture: value }));
    }
  }
};

export const compileFramePlan = (scene: RenderRoot, revision: number): FramePlan => {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`frame plan revision must be a positive safe integer; received ${String(revision)}`);
  }
  const nodes = Array.from(scene.nodes);
  const nodeKinds: FramePlanNodeKind[] = [];
  const occurrenceIndices: number[] = [];
  const orderSegments: number[] = [];
  const lightNodeIndices: number[] = [];
  const lightNodes: FramePlanLightNode[] = [];
  const pickingIds: Array<PickingId | undefined> = [];
  const renderObjectRefRows: FramePlanRenderObjectRefRow[] = [];
  const bulkInstanceRows: FramePlanBulkInstanceRow[] = [];
  const gltfRequestRows: FramePlanGltfRequestRow[] = [];
  const directTextureRows: FramePlanDirectTextureRow[] = [];
  const directGeometries: Array<CountedDirectGeometryDeclaration & { count: number }> = [];
  const directGeometryByKey = new Map<string, CountedDirectGeometryDeclaration & { count: number }>();
  const gltfRequests: Array<CountedGltfRequest & { count: number }> = [];
  const gltfByKey = new Map<string, CountedGltfRequest & { count: number }>();
  const ordinaryTextures: Array<CountedTextureDeclaration<TextureAssetRef> & { count: number }> = [];
  const ordinaryByKey = new Map<string, CountedTextureDeclaration<TextureAssetRef> & { count: number }>();
  const virtualTextures: Array<CountedTextureDeclaration<VirtualTextureAssetRef> & { count: number }> = [];
  const virtualByKey = new Map<string, CountedTextureDeclaration<VirtualTextureAssetRef> & { count: number }>();
  const renderObjectRefs: Array<CountedReference<RenderObjectRef> & { count: number }> = [];
  const renderRefCounts = new Map<RenderObjectRef, CountedReference<RenderObjectRef> & { count: number }>();
  const bulkInstances: Array<CountedReference<GltfInstanceTransforms> & { count: number }> = [];
  const bulkCounts = new Map<GltfInstanceTransforms, CountedReference<GltfInstanceTransforms> & { count: number }>();
  let orderSegment = 0;

  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex]!;
    nodeKinds.push(node.kind);
    occurrenceIndices.push(nodeIndex);
    orderSegments.push(orderSegment);
    pickingIds.push("pickingId" in node ? node.pickingId : undefined);
    if (node.kind === "directional-light" || node.kind === "point-light" || node.kind === "spot-light") {
      lightNodeIndices.push(nodeIndex);
      lightNodes.push(node);
    }
    if ((node.kind === "mesh" || node.kind === "gltf") && node.ref !== undefined) {
      if (renderRefCounts.has(node.ref)) {
        throw new Error("A render-object ref may be attached to only one scene node");
      }
      renderObjectRefRows.push({ nodeIndex, ref: node.ref });
      incrementReference(renderRefCounts, renderObjectRefs, node.ref);
    }
    if (node.kind === "gltf-instances") {
      bulkInstanceRows.push({ nodeIndex, source: node.instances });
      incrementReference(bulkCounts, bulkInstances, node.instances);
    }
    if (node.kind === "gltf" || node.kind === "gltf-instances") {
      const requestKey = gltfRequestKey(node.asset.uri, node.asset.version);
      gltfRequestRows.push({ nodeIndex, occurrenceIndex: nodeIndex, requestKey, sourceUri: node.asset.uri });
      incrementKey(gltfByKey, gltfRequests, requestKey, () => ({
        count: 1,
        key: requestKey,
        sourceUri: node.asset.uri,
        ...(node.asset.version === undefined ? {} : { version: node.asset.version }),
      }));
    } else if (node.kind === "mesh") {
      const topology = node.material.kind === "wireframe" ? "wireframe" : "surface";
      const declaration = directGeometryDeclaration(node.geometry, topology);
      const key = directGeometryDeclarationKey(declaration);
      incrementKey(directGeometryByKey, directGeometries, key, () => ({
        count: 1,
        declaration,
        key,
      }));
      orderSegment += 1;
    }
    directTextures(
      node,
      nodeIndex,
      directTextureRows,
      ordinaryByKey,
      ordinaryTextures,
      virtualByKey,
      virtualTextures,
    );
  }

  return {
    bulkInstanceRows,
    camera: scene.camera,
    clearColor: scene.clearColor,
    directTextureRows,
    environment: scene.environment,
    exposureEv100: scene.exposureEv100,
    gltfRequestRows,
    lightNodeIndices,
    lightNodes,
    manifest: { bulkInstances, directGeometries, gltfRequests, ordinaryTextures, renderObjectRefs, virtualTextures },
    nodeKinds,
    nodes,
    occurrenceIndices,
    orderSegments,
    pickingIds,
    renderObjectRefRows,
    revision,
    scene,
    toneMapping: scene.toneMapping,
  };
};

export const createResourceManifestDiffScratch = (): ResourceManifestDiffScratch => ({
  delta: {
    bulkInstances: [],
    directGeometries: [],
    gltfRequests: [],
    ordinaryTextures: [],
    renderObjectRefs: [],
    virtualTextures: [],
  },
  nextByKey: new Map(),
  nextByReference: new Map(),
  rowPools: {
    bulkInstances: [],
    directGeometries: [],
    gltfRequests: [],
    ordinaryTextures: [],
    renderObjectRefs: [],
    virtualTextures: [],
  },
  seenKeys: new Set(),
  seenReferences: new Set(),
});

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };

const writeKeyDelta = <Entry>(
  out: Array<CountedKeyDelta<Entry>>,
  pool: Array<CountedKeyDelta<Entry>>,
  index: number,
  delta: number,
  key: string,
  nextCount: number,
  previousCount: number,
  resource: Entry,
): number => {
  const retained = pool[index] as Mutable<CountedKeyDelta<Entry>> | undefined;
  if (retained === undefined) {
    const row = { delta, key, nextCount, previousCount, resource };
    pool.push(row);
    out[index] = row;
  } else {
    retained.delta = delta;
    retained.key = key;
    retained.nextCount = nextCount;
    retained.previousCount = previousCount;
    retained.resource = resource;
    out[index] = retained;
  }
  return index + 1;
};

const writeReferenceDelta = <Resource>(
  out: Array<CountedReferenceDelta<Resource>>,
  pool: Array<CountedReferenceDelta<Resource>>,
  index: number,
  nextCount: number,
  previousCount: number,
  resource: Resource,
): number => {
  const retained = pool[index] as Mutable<CountedReferenceDelta<Resource>> | undefined;
  const delta = nextCount - previousCount;
  if (retained === undefined) {
    const row = { delta, nextCount, previousCount, resource };
    pool.push(row);
    out[index] = row;
  } else {
    retained.delta = delta;
    retained.nextCount = nextCount;
    retained.previousCount = previousCount;
    retained.resource = resource;
    out[index] = retained;
  }
  return index + 1;
};

const diffKeys = <Entry extends { readonly count: number; readonly key: string }>(
  previous: readonly Entry[],
  next: readonly Entry[],
  out: Array<CountedKeyDelta<Entry>>,
  pool: Array<CountedKeyDelta<Entry>>,
  scratch: ResourceManifestDiffScratch,
): void => {
  let writeIndex = 0;
  scratch.nextByKey.clear();
  scratch.seenKeys.clear();
  for (const entry of next) scratch.nextByKey.set(entry.key, entry);
  for (const entry of previous) {
    const nextEntry = scratch.nextByKey.get(entry.key) as Entry | undefined;
    const nextCount = nextEntry?.count ?? 0;
    scratch.seenKeys.add(entry.key);
    if (entry.count !== nextCount) {
      writeIndex = writeKeyDelta(
        out, pool, writeIndex, nextCount - entry.count, entry.key, nextCount, entry.count, nextEntry ?? entry,
      );
    }
  }
  for (const entry of next) {
    if (scratch.seenKeys.has(entry.key) || entry.count === 0) continue;
    writeIndex = writeKeyDelta(out, pool, writeIndex, entry.count, entry.key, entry.count, 0, entry);
  }
  out.length = writeIndex;
};

const diffReferences = <Resource>(
  previous: readonly CountedReference<Resource>[],
  next: readonly CountedReference<Resource>[],
  out: Array<CountedReferenceDelta<Resource>>,
  pool: Array<CountedReferenceDelta<Resource>>,
  scratch: ResourceManifestDiffScratch,
): void => {
  let writeIndex = 0;
  scratch.nextByReference.clear();
  scratch.seenReferences.clear();
  for (const entry of next) scratch.nextByReference.set(entry.resource, entry.count);
  for (const entry of previous) {
    const nextCount = scratch.nextByReference.get(entry.resource) ?? 0;
    scratch.seenReferences.add(entry.resource);
    if (entry.count !== nextCount) {
      writeIndex = writeReferenceDelta(out, pool, writeIndex, nextCount, entry.count, entry.resource);
    }
  }
  for (const entry of next) {
    if (scratch.seenReferences.has(entry.resource) || entry.count === 0) continue;
    writeIndex = writeReferenceDelta(out, pool, writeIndex, entry.count, 0, entry.resource);
  }
  out.length = writeIndex;
};

/** Diff output borrows arrays owned by scratch and is overwritten by the next call. */
export const diffResourceManifests = (
  previous: FramePlanResourceManifest,
  next: FramePlanResourceManifest,
  scratch: ResourceManifestDiffScratch,
): ResourceManifestDelta => {
  const delta = scratch.delta as {
    bulkInstances: Array<CountedReferenceDelta<GltfInstanceTransforms>>;
    directGeometries: Array<CountedKeyDelta<CountedDirectGeometryDeclaration>>;
    gltfRequests: Array<CountedKeyDelta<CountedGltfRequest>>;
    ordinaryTextures: Array<CountedKeyDelta<CountedTextureDeclaration<TextureAssetRef>>>;
    renderObjectRefs: Array<CountedReferenceDelta<RenderObjectRef>>;
    virtualTextures: Array<CountedKeyDelta<CountedTextureDeclaration<VirtualTextureAssetRef>>>;
  };
  diffReferences(previous.bulkInstances, next.bulkInstances, delta.bulkInstances, scratch.rowPools.bulkInstances, scratch);
  diffKeys(
    previous.directGeometries,
    next.directGeometries,
    delta.directGeometries,
    scratch.rowPools.directGeometries,
    scratch,
  );
  diffKeys(previous.gltfRequests, next.gltfRequests, delta.gltfRequests, scratch.rowPools.gltfRequests, scratch);
  diffKeys(
    previous.ordinaryTextures,
    next.ordinaryTextures,
    delta.ordinaryTextures,
    scratch.rowPools.ordinaryTextures,
    scratch,
  );
  diffReferences(
    previous.renderObjectRefs,
    next.renderObjectRefs,
    delta.renderObjectRefs,
    scratch.rowPools.renderObjectRefs,
    scratch,
  );
  diffKeys(
    previous.virtualTextures,
    next.virtualTextures,
    delta.virtualTextures,
    scratch.rowPools.virtualTextures,
    scratch,
  );
  return scratch.delta;
};
