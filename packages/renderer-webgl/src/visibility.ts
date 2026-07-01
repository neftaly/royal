import {
  defaultTextureFallbackColor,
  type BoxGeometry,
  type GltfNode,
  type MeshNode,
  type RenderPass,
  type TextNode,
  type TextureAssetRef,
  type TextureSampler,
} from "@royal/renderer-core";
import { composeTransform, type Mat4 } from "./matrix";

export enum VisibilityPacketKind {
  Mesh = 1,
  Gltf = 2,
  VectorText = 3,
}

export enum VisibilityBoundsSource {
  BoxMesh = 1,
  GltfConservative = 2,
  TextLayout = 3,
  Unbounded = 4,
  GltfAsset = 5,
}

export interface VisibilityPacketScratch {
  readonly assetKeyHi: Uint32Array;
  readonly assetKeyLo: Uint32Array;
  readonly assetVersions: Uint32Array;
  readonly boundsSources: Uint16Array;
  readonly capacity: number;
  readonly centerX: Float32Array;
  readonly centerY: Float32Array;
  readonly centerZ: Float32Array;
  readonly idHi: Uint32Array;
  readonly idLo: Uint32Array;
  readonly kinds: Uint16Array;
  readonly materialIdHi: Uint32Array;
  readonly materialIdLo: Uint32Array;
  readonly materialVersions: Uint32Array;
  readonly maxX: Float32Array;
  readonly maxY: Float32Array;
  readonly maxZ: Float32Array;
  readonly minX: Float32Array;
  readonly minY: Float32Array;
  readonly minZ: Float32Array;
  readonly nodeIndices: Uint32Array;
  readonly objectIdHi: Uint32Array;
  readonly objectIdLo: Uint32Array;
  readonly objectVersions: Uint32Array;
  readonly packetVersions: Uint32Array;
  readonly radius: Float32Array;
}

export interface VisibilityPacketBuffer extends VisibilityPacketScratch {
  readonly count: number;
  readonly extractionVersion: number;
}

export interface VisibilityStats {
  readonly cullMs: number;
  readonly culledCount: number;
  readonly packetCount: number;
  readonly visibleCount: number;
}

export interface VisibilityCullResult {
  readonly stats: VisibilityStats;
  readonly visibleIndices: Uint32Array;
}

export interface VisibilityCullScratch {
  readonly visibleIndices: Uint32Array;
}

export interface VisibilityCullOptions {
  readonly scratch?: VisibilityCullScratch;
}

export type FrustumPlanes = Float32Array;

export type VisibilityAabb = {
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
};

export interface VisibilityPacketBuildContext {
  readonly gltfBounds?: (node: GltfNode) => VisibilityAabb | undefined;
  readonly packetScratch?: VisibilityPacketScratch;
}

type Aabb = VisibilityAabb;
type PacketId = readonly [hi: number, lo: number];

interface Sphere {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly radius: number;
}

interface PacketHeader {
  readonly assetKey: PacketId;
  readonly assetVersion: number;
  readonly id: PacketId;
  readonly materialId: PacketId;
  readonly materialVersion: number;
  readonly objectId: PacketId;
  readonly objectVersion: number;
  readonly packetVersion: number;
}

const PLANE_COMPONENTS = 4;
const PLANE_COUNT = 6;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const CULL_EPSILON = 0.000001;
const NO_PACKET_ID: PacketId = [0, 0];
const NO_VERSION = 0;

let nextExtractionVersion = 1;
let nextObjectIdentity = 1;
const objectIdentities = new WeakMap<object, PacketId>();

export const buildVisibilityPackets = (
  pass: RenderPass,
  context: VisibilityPacketBuildContext = {},
): VisibilityPacketBuffer => {
  const capacity = drawableNodeCount(pass);
  const packets = ensureVisibilityPacketScratch(context.packetScratch, capacity);
  let packetIndex = 0;

  for (let nodeIndex = 0; nodeIndex < pass.children.length; nodeIndex += 1) {
    const node = pass.children[nodeIndex];
    if (node === undefined || node.kind === "directional-light") {
      continue;
    }

    switch (node.kind) {
      case "mesh":
        writeMeshPacket(packets, packetIndex, nodeIndex, node);
        packetIndex += 1;
        break;
      case "gltf":
        writeGltfPacket(packets, packetIndex, nodeIndex, node, context);
        packetIndex += 1;
        break;
      case "text":
        writeTextPacket(packets, packetIndex, nodeIndex, node);
        packetIndex += 1;
        break;
      default:
        assertNever(node);
    }
  }

  return {
    ...packets,
    count: packetIndex,
    extractionVersion: nextVisibilityExtractionVersion(),
  };
};

const writeGltfPacket = (
  packets: VisibilityPacketScratch,
  packetIndex: number,
  nodeIndex: number,
  node: GltfNode,
  context: VisibilityPacketBuildContext,
): void => {
  const header = gltfPacketHeader(node);
  const bounds = context.gltfBounds?.(node);
  if (bounds !== undefined && isFiniteAabb(bounds)) {
    writeBoundedPacket(
      packets,
      packetIndex,
      nodeIndex,
      VisibilityPacketKind.Gltf,
      VisibilityBoundsSource.GltfAsset,
      bounds,
      header,
    );
    return;
  }

  writeUnboundedPacket(
    packets,
    packetIndex,
    nodeIndex,
    VisibilityPacketKind.Gltf,
    VisibilityBoundsSource.GltfConservative,
    header,
  );
};

export const extractFrustumPlanes = (viewProjectionMatrix: Mat4): FrustumPlanes => {
  const planes = new Float32Array(PLANE_COUNT * PLANE_COMPONENTS);

  writePlane(
    planes,
    0,
    viewProjectionMatrix[3] + viewProjectionMatrix[0],
    viewProjectionMatrix[7] + viewProjectionMatrix[4],
    viewProjectionMatrix[11] + viewProjectionMatrix[8],
    viewProjectionMatrix[15] + viewProjectionMatrix[12],
  );
  writePlane(
    planes,
    1,
    viewProjectionMatrix[3] - viewProjectionMatrix[0],
    viewProjectionMatrix[7] - viewProjectionMatrix[4],
    viewProjectionMatrix[11] - viewProjectionMatrix[8],
    viewProjectionMatrix[15] - viewProjectionMatrix[12],
  );
  writePlane(
    planes,
    2,
    viewProjectionMatrix[3] + viewProjectionMatrix[1],
    viewProjectionMatrix[7] + viewProjectionMatrix[5],
    viewProjectionMatrix[11] + viewProjectionMatrix[9],
    viewProjectionMatrix[15] + viewProjectionMatrix[13],
  );
  writePlane(
    planes,
    3,
    viewProjectionMatrix[3] - viewProjectionMatrix[1],
    viewProjectionMatrix[7] - viewProjectionMatrix[5],
    viewProjectionMatrix[11] - viewProjectionMatrix[9],
    viewProjectionMatrix[15] - viewProjectionMatrix[13],
  );
  writePlane(
    planes,
    4,
    viewProjectionMatrix[3] + viewProjectionMatrix[2],
    viewProjectionMatrix[7] + viewProjectionMatrix[6],
    viewProjectionMatrix[11] + viewProjectionMatrix[10],
    viewProjectionMatrix[15] + viewProjectionMatrix[14],
  );
  writePlane(
    planes,
    5,
    viewProjectionMatrix[3] - viewProjectionMatrix[2],
    viewProjectionMatrix[7] - viewProjectionMatrix[6],
    viewProjectionMatrix[11] - viewProjectionMatrix[10],
    viewProjectionMatrix[15] - viewProjectionMatrix[14],
  );

  return planes;
};

export const cullVisibilityPackets = (
  packets: VisibilityPacketBuffer,
  frustumPlanes: FrustumPlanes,
  options: VisibilityCullOptions = {},
): VisibilityCullResult => {
  const startedAt = now();
  const visibleIndices = ensureVisibleIndexBuffer(options.scratch, packets.count);
  let visibleCount = 0;

  for (let packetIndex = 0; packetIndex < packets.count; packetIndex += 1) {
    if (isPacketVisible(packets, packetIndex, frustumPlanes)) {
      visibleIndices[visibleCount] = packetIndex;
      visibleCount += 1;
    }
  }

  return {
    stats: {
      cullMs: now() - startedAt,
      culledCount: packets.count - visibleCount,
      packetCount: packets.count,
      visibleCount,
    },
    visibleIndices: visibleIndices.subarray(0, visibleCount),
  };
};

export const createVisibilityPacketScratch = (capacity: number): VisibilityPacketScratch => {
  const safeCapacity = Math.max(0, Math.ceil(capacity));
  return {
    assetKeyHi: new Uint32Array(safeCapacity),
    assetKeyLo: new Uint32Array(safeCapacity),
    assetVersions: new Uint32Array(safeCapacity),
    boundsSources: new Uint16Array(safeCapacity),
    capacity: safeCapacity,
    centerX: new Float32Array(safeCapacity),
    centerY: new Float32Array(safeCapacity),
    centerZ: new Float32Array(safeCapacity),
    idHi: new Uint32Array(safeCapacity),
    idLo: new Uint32Array(safeCapacity),
    kinds: new Uint16Array(safeCapacity),
    materialIdHi: new Uint32Array(safeCapacity),
    materialIdLo: new Uint32Array(safeCapacity),
    materialVersions: new Uint32Array(safeCapacity),
    maxX: new Float32Array(safeCapacity),
    maxY: new Float32Array(safeCapacity),
    maxZ: new Float32Array(safeCapacity),
    minX: new Float32Array(safeCapacity),
    minY: new Float32Array(safeCapacity),
    minZ: new Float32Array(safeCapacity),
    nodeIndices: new Uint32Array(safeCapacity),
    objectIdHi: new Uint32Array(safeCapacity),
    objectIdLo: new Uint32Array(safeCapacity),
    objectVersions: new Uint32Array(safeCapacity),
    packetVersions: new Uint32Array(safeCapacity),
    radius: new Float32Array(safeCapacity),
  };
};

export const createVisibilityCullScratch = (capacity: number): VisibilityCullScratch => ({
  visibleIndices: new Uint32Array(Math.max(0, Math.ceil(capacity))),
});

const drawableNodeCount = (pass: RenderPass): number => {
  let count = 0;
  for (const node of pass.children) {
    if (node.kind !== "directional-light") count += 1;
  }
  return count;
};

const ensureVisibilityPacketScratch = (
  scratch: VisibilityPacketScratch | undefined,
  capacity: number,
): VisibilityPacketScratch =>
  scratch !== undefined && scratch.capacity >= capacity
    ? scratch
    : createVisibilityPacketScratch(capacity);

const ensureVisibleIndexBuffer = (
  scratch: VisibilityCullScratch | undefined,
  capacity: number,
): Uint32Array =>
  scratch !== undefined && scratch.visibleIndices.length >= capacity
    ? scratch.visibleIndices
    : new Uint32Array(capacity);

const writeMeshPacket = (
  packets: VisibilityPacketScratch,
  packetIndex: number,
  nodeIndex: number,
  mesh: MeshNode,
): void => {
  const header = meshPacketHeader(mesh);
  if (mesh.geometry.kind !== "box") {
    writeUnboundedPacket(
      packets,
      packetIndex,
      nodeIndex,
      VisibilityPacketKind.Mesh,
      VisibilityBoundsSource.Unbounded,
      header,
    );
    return;
  }

  const geometry = mesh.geometry as BoxGeometry;
  const bounds = transformAabb(boxLocalAabb(geometry.size), composeTransform(mesh.transform));
  writeBoundedPacket(
    packets,
    packetIndex,
    nodeIndex,
    VisibilityPacketKind.Mesh,
    VisibilityBoundsSource.BoxMesh,
    bounds,
    header,
  );
};

const writeTextPacket = (
  packets: VisibilityPacketScratch,
  packetIndex: number,
  nodeIndex: number,
  node: TextNode,
): void => {
  const header = textPacketHeader(node);
  const bounds = textLayoutAabb(node);
  if (!isFiniteAabb(bounds)) {
    writeUnboundedPacket(
      packets,
      packetIndex,
      nodeIndex,
      VisibilityPacketKind.VectorText,
      VisibilityBoundsSource.Unbounded,
      header,
    );
    return;
  }

  writeBoundedPacket(
    packets,
    packetIndex,
    nodeIndex,
    VisibilityPacketKind.VectorText,
    VisibilityBoundsSource.TextLayout,
    bounds,
    header,
  );
};

const writeBoundedPacket = (
  packets: VisibilityPacketScratch,
  packetIndex: number,
  nodeIndex: number,
  kind: VisibilityPacketKind,
  boundsSource: VisibilityBoundsSource,
  bounds: Aabb,
  header: PacketHeader,
): void => {
  const sphere = sphereFromAabb(bounds);
  writePacketHeader(
    packets,
    packetIndex,
    nodeIndex,
    kind,
    boundsSource,
    header,
    aabbVersion(bounds),
  );
  packets.minX[packetIndex] = bounds.minX;
  packets.minY[packetIndex] = bounds.minY;
  packets.minZ[packetIndex] = bounds.minZ;
  packets.maxX[packetIndex] = bounds.maxX;
  packets.maxY[packetIndex] = bounds.maxY;
  packets.maxZ[packetIndex] = bounds.maxZ;
  packets.centerX[packetIndex] = sphere.centerX;
  packets.centerY[packetIndex] = sphere.centerY;
  packets.centerZ[packetIndex] = sphere.centerZ;
  packets.radius[packetIndex] = sphere.radius;
};

const writeUnboundedPacket = (
  packets: VisibilityPacketScratch,
  packetIndex: number,
  nodeIndex: number,
  kind: VisibilityPacketKind,
  boundsSource: VisibilityBoundsSource,
  header: PacketHeader,
): void => {
  writePacketHeader(packets, packetIndex, nodeIndex, kind, boundsSource, header, NO_VERSION);
  packets.minX[packetIndex] = Number.NEGATIVE_INFINITY;
  packets.minY[packetIndex] = Number.NEGATIVE_INFINITY;
  packets.minZ[packetIndex] = Number.NEGATIVE_INFINITY;
  packets.maxX[packetIndex] = Number.POSITIVE_INFINITY;
  packets.maxY[packetIndex] = Number.POSITIVE_INFINITY;
  packets.maxZ[packetIndex] = Number.POSITIVE_INFINITY;
  packets.centerX[packetIndex] = 0;
  packets.centerY[packetIndex] = 0;
  packets.centerZ[packetIndex] = 0;
  packets.radius[packetIndex] = Number.POSITIVE_INFINITY;
};

const writePacketHeader = (
  packets: VisibilityPacketScratch,
  packetIndex: number,
  nodeIndex: number,
  kind: VisibilityPacketKind,
  boundsSource: VisibilityBoundsSource,
  header: PacketHeader,
  boundsVersion: number,
): void => {
  packets.nodeIndices[packetIndex] = nodeIndex;
  packets.kinds[packetIndex] = kind;
  packets.boundsSources[packetIndex] = boundsSource;
  packets.idHi[packetIndex] = header.id[0];
  packets.idLo[packetIndex] = header.id[1];
  packets.objectIdHi[packetIndex] = header.objectId[0];
  packets.objectIdLo[packetIndex] = header.objectId[1];
  packets.objectVersions[packetIndex] = header.objectVersion;
  packets.materialIdHi[packetIndex] = header.materialId[0];
  packets.materialIdLo[packetIndex] = header.materialId[1];
  packets.materialVersions[packetIndex] = header.materialVersion;
  packets.assetKeyHi[packetIndex] = header.assetKey[0];
  packets.assetKeyLo[packetIndex] = header.assetKey[1];
  packets.assetVersions[packetIndex] = header.assetVersion;
  packets.packetVersions[packetIndex] = packetVersionWithBounds(
    header.packetVersion,
    boundsSource,
    boundsVersion,
  );
};

const meshPacketHeader = (mesh: MeshNode): PacketHeader => {
  const objectId = objectPacketId(mesh);
  const materialId = materialPacketId(mesh.material);
  const assetKey = textureAssetPacketId(mesh.material.baseColor);
  const objectVersion = meshObjectVersion(mesh);
  const materialVersion = materialPacketVersion(mesh.material);
  const assetVersion = textureAssetPacketVersion(mesh.material.baseColor);
  return packetHeader(
    VisibilityPacketKind.Mesh,
    objectId,
    objectVersion,
    materialId,
    materialVersion,
    assetKey,
    assetVersion,
  );
};

const gltfPacketHeader = (node: GltfNode): PacketHeader => {
  const objectId = objectPacketId(node);
  const assetKey = gltfAssetPacketId(node.asset);
  const objectVersion = transformVersion(node.transform);
  const assetVersion = gltfAssetPacketVersion(node.asset);
  return packetHeader(
    VisibilityPacketKind.Gltf,
    objectId,
    objectVersion,
    NO_PACKET_ID,
    NO_VERSION,
    assetKey,
    assetVersion,
  );
};

const textPacketHeader = (node: TextNode): PacketHeader => {
  const objectId = objectPacketId(node);
  const materialId = textMaterialPacketId(node);
  const objectVersion = textLayoutVersion(node);
  const materialVersion = textMaterialPacketVersion(node);
  return packetHeader(
    VisibilityPacketKind.VectorText,
    objectId,
    objectVersion,
    materialId,
    materialVersion,
    NO_PACKET_ID,
    NO_VERSION,
  );
};

const packetHeader = (
  kind: VisibilityPacketKind,
  objectId: PacketId,
  objectVersion: number,
  materialId: PacketId,
  materialVersion: number,
  assetKey: PacketId,
  assetVersion: number,
): PacketHeader => ({
  assetKey,
  assetVersion,
  id: hashPacketId(kind, objectId, materialId, assetKey),
  materialId,
  materialVersion,
  objectId,
  objectVersion,
  packetVersion: hashVersion(
    "packet",
    kind,
    objectVersion,
    materialVersion,
    assetVersion,
  ),
});

const objectPacketId = (node: object): PacketId => {
  const existing = objectIdentities.get(node);
  if (existing !== undefined) return existing;

  const id: PacketId = [hashString32("visibility-object"), nextObjectIdentity];
  objectIdentities.set(node, id);
  nextObjectIdentity = nextCounterVersion(nextObjectIdentity);
  return id;
};

const meshObjectVersion = (mesh: MeshNode): number =>
  hashVersion(
    "mesh-object",
    geometryVersion(mesh.geometry),
    transformVersion(mesh.transform),
  );

const geometryVersion = (geometry: MeshNode["geometry"]): number => {
  if (geometry.kind === "box") {
    const box = geometry as BoxGeometry;
    return hashVersion("box", box.size[0], box.size[1], box.size[2]);
  }
  return hashVersion("geometry", geometry.kind);
};

const materialPacketId = (material: MeshNode["material"]): PacketId => {
  const textureId = texturePacketId(material.baseColor);
  return hashLabelId("material", `${material.kind}:${textureId[0]}:${textureId[1]}`);
};

const materialPacketVersion = (material: MeshNode["material"]): number => {
  if (material.kind === "wireframe") {
    return hashVersion(
      "wireframe-material",
      material.width,
      texturePacketVersion(material.baseColor),
    );
  }
  return hashVersion(material.kind, texturePacketVersion(material.baseColor));
};

const texturePacketId = (texture: MeshNode["material"]["baseColor"]): PacketId => {
  if (texture.kind === "asset") {
    return hashLabelId("texture-asset", texture.uri);
  }
  if (texture.kind === "virtual-asset") {
    return hashLabelId(
      "virtual-texture-asset",
      `${texture.manifestUri}:${virtualTexturePreviewKey(texture.preview)}:${textureFallbackColorKey(texture)}`,
    );
  }
  if (texture.id !== undefined) {
    return hashLabelId("solid-texture", texture.id);
  }
  return hashLabelId("solid-texture", texture.color.join(","));
};

const texturePacketVersion = (texture: MeshNode["material"]["baseColor"]): number => {
  if (texture.kind === "asset") {
    return hashVersion(
      "texture-asset",
      texture.revision ?? texture.uri,
      texture.colorSpace ?? "",
      samplerVersion(texture.sampler),
    );
  }
  if (texture.kind === "virtual-asset") {
    return hashVersion(
      "virtual-texture-asset",
      texture.revision ?? texture.manifestUri,
      texture.colorSpace ?? "",
      samplerVersion(texture.sampler),
      virtualTexturePreviewVersion(texture.preview),
      textureFallbackColorKey(texture),
      texture.fallback?.revision ?? "",
    );
  }
  return hashVersion(
    "solid-texture",
    texture.color[0],
    texture.color[1],
    texture.color[2],
    texture.color[3],
    texture.colorSpace ?? "",
    texture.revision ?? "",
  );
};

const textureAssetPacketId = (texture: MeshNode["material"]["baseColor"]): PacketId =>
  texture.kind === "asset"
    ? hashLabelId("texture-asset", texture.uri)
    : texture.kind === "virtual-asset"
      ? hashLabelId(
          "virtual-texture-asset",
          `${texture.manifestUri}:${virtualTexturePreviewKey(texture.preview)}`,
        )
      : NO_PACKET_ID;

const textureAssetPacketVersion = (texture: MeshNode["material"]["baseColor"]): number =>
  texture.kind === "asset"
    ? hashVersion("texture-asset", texture.revision ?? texture.uri)
    : texture.kind === "virtual-asset"
      ? hashVersion(
          "virtual-texture-asset",
          texture.revision ?? texture.manifestUri,
          samplerVersion(texture.sampler),
          virtualTexturePreviewVersion(texture.preview),
          textureFallbackColorKey(texture),
        )
      : NO_VERSION;

const textureFallbackColorKey = (
  texture: Extract<MeshNode["material"]["baseColor"], { readonly kind: "virtual-asset" }>,
): string => (texture.fallback?.color ?? texture.preview?.fallback?.color ?? defaultTextureFallbackColor).join(",");

const virtualTexturePreviewKey = (preview: TextureAssetRef | undefined): string =>
  preview === undefined ? "" : preview.uri;

const virtualTexturePreviewVersion = (preview: TextureAssetRef | undefined): string =>
  preview === undefined
    ? ""
    : [
        preview.revision ?? preview.uri,
        preview.colorSpace ?? "",
        samplerVersion(preview.sampler),
        preview.fallback?.revision ?? "",
        preview.fallback?.color.join(",") ?? "",
      ].join("|");

const samplerVersion = (sampler: TextureSampler | undefined): string => {
  if (sampler === undefined) return "";
  const value = sampler as {
    readonly magFilter?: string;
    readonly minFilter?: string;
    readonly wrapS?: string;
    readonly wrapT?: string;
  };
  return [
    value.magFilter ?? "",
    value.minFilter ?? "",
    value.wrapS ?? "",
    value.wrapT ?? "",
  ].join(":");
};

const gltfAssetPacketId = (asset: GltfNode["asset"]): PacketId =>
  hashLabelId("gltf-asset", asset.uri);

const gltfAssetPacketVersion = (asset: GltfNode["asset"]): number =>
  hashVersion(
    "gltf-asset",
    asset.revision ?? asset.uri,
    asset.bounds?.min.join(",") ?? "",
    asset.bounds?.max.join(",") ?? "",
  );

const textMaterialPacketId = (node: TextNode): PacketId =>
  hashLabelId("text-material", node.color.join(","));

const textMaterialPacketVersion = (node: TextNode): number =>
  hashVersion(
    "text-material",
    node.color[0],
    node.color[1],
    node.color[2],
    node.color[3],
  );

const textLayoutVersion = (node: TextNode): number =>
  hashVersion(
    "text-layout",
    node.layout.source,
    node.layout.bounds.xMin,
    node.layout.bounds.yMin,
    node.layout.bounds.xMax,
    node.layout.bounds.yMax,
    node.layout.lines.length,
  );

const transformVersion = (transform: MeshNode["transform"]): number => {
  if (transform === undefined) return hashVersion("transform", "identity");
  return hashVersion(
    "transform",
    transform.position[0],
    transform.position[1],
    transform.position[2],
    transform.rotation[0],
    transform.rotation[1],
    transform.rotation[2],
    transform.scale[0],
    transform.scale[1],
    transform.scale[2],
  );
};

const aabbVersion = (bounds: Aabb): number =>
  hashVersion(
    "aabb",
    bounds.minX,
    bounds.minY,
    bounds.minZ,
    bounds.maxX,
    bounds.maxY,
    bounds.maxZ,
  );

const packetVersionWithBounds = (
  packetVersion: number,
  boundsSource: VisibilityBoundsSource,
  boundsVersion: number,
): number => hashVersion("packet-bounds", packetVersion, boundsSource, boundsVersion);

const nextVisibilityExtractionVersion = (): number => {
  const version = nextExtractionVersion;
  nextExtractionVersion = nextCounterVersion(nextExtractionVersion);
  return version;
};

const nextCounterVersion = (version: number): number => {
  const nextVersion = (version + 1) >>> 0;
  return nextVersion === 0 ? 1 : nextVersion;
};

const boxLocalAabb = (size: readonly [number, number, number]): Aabb => {
  const halfX = Math.abs(size[0]) / 2;
  const halfY = Math.abs(size[1]) / 2;
  const halfZ = Math.abs(size[2]) / 2;

  return {
    maxX: halfX,
    maxY: halfY,
    maxZ: halfZ,
    minX: -halfX,
    minY: -halfY,
    minZ: -halfZ,
  };
};

const transformAabb = (bounds: Aabb, matrix: Mat4): Aabb => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        const transformedX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const transformedY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        const transformedZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
        minX = Math.min(minX, transformedX);
        minY = Math.min(minY, transformedY);
        minZ = Math.min(minZ, transformedZ);
        maxX = Math.max(maxX, transformedX);
        maxY = Math.max(maxY, transformedY);
        maxZ = Math.max(maxZ, transformedZ);
      }
    }
  }

  return { maxX, maxY, maxZ, minX, minY, minZ };
};

const textLayoutAabb = (node: TextNode): Aabb => {
  const { bounds } = node.layout;
  let minZ = 0;
  let maxZ = 0;
  let foundGlyph = false;

  for (const line of node.layout.lines) {
    for (const glyph of line.glyphs) {
      const z = glyph.origin[2];
      minZ = foundGlyph ? Math.min(minZ, z) : z;
      maxZ = foundGlyph ? Math.max(maxZ, z) : z;
      foundGlyph = true;
    }
  }

  return {
    maxX: bounds.xMax,
    maxY: bounds.yMax,
    maxZ,
    minX: bounds.xMin,
    minY: bounds.yMin,
    minZ,
  };
};

const sphereFromAabb = (bounds: Aabb): Sphere => {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  return {
    centerX,
    centerY,
    centerZ,
    radius: Math.hypot(bounds.maxX - centerX, bounds.maxY - centerY, bounds.maxZ - centerZ),
  };
};

const isPacketVisible = (
  packets: VisibilityPacketBuffer,
  packetIndex: number,
  frustumPlanes: FrustumPlanes,
): boolean => {
  const radius = packets.radius[packetIndex]!;
  if (radius === Number.POSITIVE_INFINITY) return true;

  const centerX = packets.centerX[packetIndex]!;
  const centerY = packets.centerY[packetIndex]!;
  const centerZ = packets.centerZ[packetIndex]!;

  for (let planeIndex = 0; planeIndex < PLANE_COUNT; planeIndex += 1) {
    const offset = planeIndex * PLANE_COMPONENTS;
    const distance =
      frustumPlanes[offset]! * centerX +
      frustumPlanes[offset + 1]! * centerY +
      frustumPlanes[offset + 2]! * centerZ +
      frustumPlanes[offset + 3]!;
    if (distance < -radius - CULL_EPSILON) return false;
  }

  return true;
};

const writePlane = (
  planes: FrustumPlanes,
  planeIndex: number,
  x: number,
  y: number,
  z: number,
  w: number,
): void => {
  const length = Math.hypot(x, y, z);
  if (length === 0) throw new Error("Invalid frustum plane");
  const offset = planeIndex * PLANE_COMPONENTS;
  planes[offset] = x / length;
  planes[offset + 1] = y / length;
  planes[offset + 2] = z / length;
  planes[offset + 3] = w / length;
};

const isFiniteAabb = (bounds: Aabb): boolean =>
  Number.isFinite(bounds.minX) &&
  Number.isFinite(bounds.minY) &&
  Number.isFinite(bounds.minZ) &&
  Number.isFinite(bounds.maxX) &&
  Number.isFinite(bounds.maxY) &&
  Number.isFinite(bounds.maxZ);

const hashPacketId = (
  kind: VisibilityPacketKind,
  objectId: PacketId,
  materialId: PacketId,
  assetKey: PacketId,
): PacketId => {
  const hi = hashString32(`packet:${kind}:${objectId[0]}:${objectId[1]}`);
  return [
    hi,
    hashString32(
      `${materialId[0]}:${materialId[1]}:${assetKey[0]}:${assetKey[1]}`,
      hi,
    ),
  ];
};

const hashLabelId = (namespace: string, label: string): PacketId => {
  const hi = hashString32(namespace);
  return [hi, hashString32(label, hi)];
};

const hashVersion = (
  namespace: string,
  ...components: readonly (number | string)[]
): number => hashString32(components.map(String).join("\u001f"), hashString32(namespace));

const hashString32 = (value: string, seed = FNV_OFFSET): number => {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};

const now = (): number => {
  if (typeof globalThis.performance?.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
};

const assertNever = (value: never): never => {
  throw new Error(`Unsupported render node kind: ${String(value)}`);
};
