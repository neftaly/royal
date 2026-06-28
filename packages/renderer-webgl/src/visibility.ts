import {
  GeometryKind,
  RenderNodeKind,
  type BoxGeometry,
  type MeshNode,
  type RenderPass,
  type TextNode,
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
}

export interface VisibilityPacketBuffer {
  readonly boundsSources: Uint16Array;
  readonly centerX: Float32Array;
  readonly centerY: Float32Array;
  readonly centerZ: Float32Array;
  readonly count: number;
  readonly idHi: Uint32Array;
  readonly idLo: Uint32Array;
  readonly kinds: Uint16Array;
  readonly maxX: Float32Array;
  readonly maxY: Float32Array;
  readonly maxZ: Float32Array;
  readonly minX: Float32Array;
  readonly minY: Float32Array;
  readonly minZ: Float32Array;
  readonly nodeIndices: Uint32Array;
  readonly radius: Float32Array;
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

export type FrustumPlanes = Float32Array;

interface Aabb {
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
}

interface Sphere {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly radius: number;
}

const PLANE_COMPONENTS = 4;
const PLANE_COUNT = 6;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const CULL_EPSILON = 0.000001;

export const buildVisibilityPackets = (pass: RenderPass): VisibilityPacketBuffer => {
  const capacity = drawableNodeCount(pass);
  const packets = createVisibilityPacketBuffer(capacity);
  let packetIndex = 0;

  for (let nodeIndex = 0; nodeIndex < pass.children.length; nodeIndex += 1) {
    const node = pass.children[nodeIndex];
    if (node === undefined || node.kind === RenderNodeKind.DirectionalLight) {
      continue;
    }

    switch (node.kind) {
      case RenderNodeKind.Mesh:
        writeMeshPacket(packets, packetIndex, nodeIndex, node);
        packetIndex += 1;
        break;
      case RenderNodeKind.Gltf:
        writeUnboundedPacket(
          packets,
          packetIndex,
          nodeIndex,
          VisibilityPacketKind.Gltf,
          VisibilityBoundsSource.GltfConservative,
          hashPacketId(VisibilityPacketKind.Gltf, nodeIndex, node.src),
        );
        packetIndex += 1;
        break;
      case RenderNodeKind.VectorText:
        writeTextPacket(packets, packetIndex, nodeIndex, node);
        packetIndex += 1;
        break;
      default:
        assertNever(node);
    }
  }

  return { ...packets, count: packetIndex };
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
): VisibilityCullResult => {
  const startedAt = now();
  const visibleIndices = new Uint32Array(packets.count);
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

const drawableNodeCount = (pass: RenderPass): number => {
  let count = 0;
  for (const node of pass.children) {
    if (node.kind !== RenderNodeKind.DirectionalLight) count += 1;
  }
  return count;
};

const createVisibilityPacketBuffer = (
  capacity: number,
): Omit<VisibilityPacketBuffer, "count"> => ({
  boundsSources: new Uint16Array(capacity),
  centerX: new Float32Array(capacity),
  centerY: new Float32Array(capacity),
  centerZ: new Float32Array(capacity),
  idHi: new Uint32Array(capacity),
  idLo: new Uint32Array(capacity),
  kinds: new Uint16Array(capacity),
  maxX: new Float32Array(capacity),
  maxY: new Float32Array(capacity),
  maxZ: new Float32Array(capacity),
  minX: new Float32Array(capacity),
  minY: new Float32Array(capacity),
  minZ: new Float32Array(capacity),
  nodeIndices: new Uint32Array(capacity),
  radius: new Float32Array(capacity),
});

const writeMeshPacket = (
  packets: Omit<VisibilityPacketBuffer, "count">,
  packetIndex: number,
  nodeIndex: number,
  mesh: MeshNode,
): void => {
  if (mesh.geometry.kind !== GeometryKind.Box) {
    writeUnboundedPacket(
      packets,
      packetIndex,
      nodeIndex,
      VisibilityPacketKind.Mesh,
      VisibilityBoundsSource.Unbounded,
      hashPacketId(VisibilityPacketKind.Mesh, nodeIndex, String(mesh.geometry.kind)),
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
    hashPacketId(VisibilityPacketKind.Mesh, nodeIndex, `box:${geometry.size.join(",")}`),
  );
};

const writeTextPacket = (
  packets: Omit<VisibilityPacketBuffer, "count">,
  packetIndex: number,
  nodeIndex: number,
  node: TextNode,
): void => {
  const bounds = textLayoutAabb(node);
  if (!isFiniteAabb(bounds)) {
    writeUnboundedPacket(
      packets,
      packetIndex,
      nodeIndex,
      VisibilityPacketKind.VectorText,
      VisibilityBoundsSource.Unbounded,
      hashPacketId(VisibilityPacketKind.VectorText, nodeIndex, node.layout.source),
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
    hashPacketId(VisibilityPacketKind.VectorText, nodeIndex, node.layout.source),
  );
};

const writeBoundedPacket = (
  packets: Omit<VisibilityPacketBuffer, "count">,
  packetIndex: number,
  nodeIndex: number,
  kind: VisibilityPacketKind,
  boundsSource: VisibilityBoundsSource,
  bounds: Aabb,
  id: readonly [hi: number, lo: number],
): void => {
  const sphere = sphereFromAabb(bounds);
  writePacketHeader(packets, packetIndex, nodeIndex, kind, boundsSource, id);
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
  packets: Omit<VisibilityPacketBuffer, "count">,
  packetIndex: number,
  nodeIndex: number,
  kind: VisibilityPacketKind,
  boundsSource: VisibilityBoundsSource,
  id: readonly [hi: number, lo: number],
): void => {
  writePacketHeader(packets, packetIndex, nodeIndex, kind, boundsSource, id);
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
  packets: Omit<VisibilityPacketBuffer, "count">,
  packetIndex: number,
  nodeIndex: number,
  kind: VisibilityPacketKind,
  boundsSource: VisibilityBoundsSource,
  id: readonly [hi: number, lo: number],
): void => {
  packets.nodeIndices[packetIndex] = nodeIndex;
  packets.kinds[packetIndex] = kind;
  packets.boundsSources[packetIndex] = boundsSource;
  packets.idHi[packetIndex] = id[0];
  packets.idLo[packetIndex] = id[1];
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
  nodeIndex: number,
  label: string,
): readonly [hi: number, lo: number] => {
  const hi = hashString32(`${kind}:${nodeIndex}`);
  return [hi, hashString32(label, hi)];
};

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
