import type { BoxGeometry, Geometry, PlaneGeometry } from "@royal/renderer-core";
import type { GltfGeometryDrawMode } from "./gltf/prepared-asset";
import type { GeometryByteLayout } from "./vertex-input/geometry-identity";

export type CpuGeometry = GeometryByteLayout & {
  readonly bucketKey: string;
  readonly colors?: Float32Array;
  readonly indices?: Uint8Array | Uint16Array | Uint32Array;
  readonly mode: GltfGeometryDrawMode;
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly tangents?: Float32Array;
  readonly texCoords0?: Float32Array;
  readonly texCoords1?: Float32Array;
};

export type DirectGeometryTopology = "surface" | "wireframe";

export interface DirectGeometryDeclaration {
  readonly geometry: BoxGeometry | PlaneGeometry;
  readonly kind: "direct-geometry";
  readonly topology: DirectGeometryTopology;
}

const preparedGltfGeometryDeclaration = Symbol("royal.prepared-gltf-geometry-declaration");

/** Prepared arrays are borrowed immutable-by-ownership; changed bytes require a new declaration. */
export interface GltfGeometryDeclaration {
  readonly bucketKey: string;
  readonly colors?: Float32Array;
  readonly indices?: Uint8Array | Uint16Array | Uint32Array;
  readonly kind: "gltf-geometry";
  readonly mode: GltfGeometryDrawMode;
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly tangents?: Float32Array;
  readonly texCoords0?: Float32Array;
  readonly texCoords1?: Float32Array;
  readonly [preparedGltfGeometryDeclaration]: true;
}

export type GeometryDeclaration = DirectGeometryDeclaration | GltfGeometryDeclaration;

const FNV_1A_32_OFFSET = 0x811c9dc5;
const FNV_1A_32_PRIME = 0x01000193;
const geometryArrayHashes = new WeakMap<object, string>();

const geometryArrayHash = (array: ArrayBufferView): string => {
  const key = array as object;
  const cached = geometryArrayHashes.get(key);
  if (cached !== undefined) return cached;
  let hash = FNV_1A_32_OFFSET;
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_1A_32_PRIME) >>> 0;
  }
  const encoded = hash.toString(16).padStart(8, "0");
  geometryArrayHashes.set(key, encoded);
  return encoded;
};

export const geometryArrayBucketKey = (array: ArrayBufferView | undefined): string => {
  if (array === undefined) return "none";
  return `${array.constructor.name}:${array.byteLength}:${geometryArrayHash(array)}`;
};

const geometryBucketKey = (geometry: GeometryByteLayout): string => [
  "geometry-v1",
  geometry.mode,
  geometryArrayBucketKey(geometry.positions),
  geometryArrayBucketKey(geometry.normals),
  geometryArrayBucketKey(geometry.tangents),
  geometryArrayBucketKey(geometry.colors),
  geometryArrayBucketKey(geometry.texCoords0),
  geometryArrayBucketKey(geometry.texCoords1),
  geometryArrayBucketKey(geometry.indices),
].join("|");

const dimensions = (value: unknown, count: number, label: string): number[] => {
  if (
    !Array.isArray(value)
    || value.length !== count
    || value.some((dimension) => typeof dimension !== "number" || !Number.isFinite(dimension) || dimension <= 0)
  ) throw new Error(`Invalid ${label} geometry size`);
  return value;
};

export const directGeometryDeclaration = (
  geometry: Geometry,
  topology: DirectGeometryTopology,
): DirectGeometryDeclaration => {
  const kind = geometry.kind;
  if (kind !== "box" && kind !== "plane") {
    throw new Error(`Unsupported geometry kind "${String(kind)}"`);
  }
  const size = Object.freeze([...dimensions(geometry.size, kind === "box" ? 3 : 2, kind)]);
  return Object.freeze({
    geometry: Object.freeze({ kind, size }) as BoxGeometry | PlaneGeometry,
    kind: "direct-geometry",
    topology,
  });
};

export const directGeometryKey = (
  geometry: Geometry,
  topology: DirectGeometryTopology,
): string => `direct:${topology}:${geometry.kind}:${geometry.size.join(",")}`;

export const gltfGeometryDeclaration = (
  geometry: Omit<GltfGeometryDeclaration, "bucketKey" | "kind" | typeof preparedGltfGeometryDeclaration>,
): GltfGeometryDeclaration => {
  const bucketKey = geometryBucketKey(geometry);
  return Object.freeze({
    ...geometry,
    bucketKey,
    kind: "gltf-geometry",
    [preparedGltfGeometryDeclaration]: true as const,
  });
};

export const geometryDeclarationBucketKey = (declaration: GeometryDeclaration): string => {
  if (declaration.kind === "direct-geometry") {
    return directGeometryKey(declaration.geometry, declaration.topology);
  }
  return declaration.bucketKey;
};

const planeGeometry = (geometry: PlaneGeometry, topology: DirectGeometryTopology): CpuGeometry => {
  const [width, height] = geometry.size;
  const x = width / 2;
  const y = height / 2;
  if (topology === "wireframe") {
    return {
      bucketKey: `direct:wireframe:plane:${width},${height}`,
      indices: new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]),
      mode: "lines",
      positions: new Float32Array([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]),
      texCoords0: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    };
  }
  return {
    bucketKey: `direct:surface:plane:${width},${height}`,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    mode: "triangles",
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    positions: new Float32Array([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]),
    texCoords0: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  };
};

const boxGeometry = (geometry: BoxGeometry, topology: DirectGeometryTopology): CpuGeometry => {
  const [width, height, depth] = geometry.size;
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  if (topology === "wireframe") {
    return {
      bucketKey: `direct:wireframe:box:${width},${height},${depth}`,
      indices: new Uint16Array([
        0, 1, 1, 2, 2, 3, 3, 0,
        4, 5, 5, 6, 6, 7, 7, 4,
        0, 4, 1, 5, 2, 6, 3, 7,
      ]),
      mode: "lines",
      positions: new Float32Array([
        -x, -y, z, x, -y, z, x, y, z, -x, y, z,
        -x, -y, -z, x, -y, -z, x, y, -z, -x, y, -z,
      ]),
    };
  }
  // Royal and glTF texture coordinates use an upper-left authored origin.
  // Each face's first two vertices form its lower edge, so their V is 1.
  const faceUvs = [0, 1, 1, 1, 1, 0, 0, 0];
  return {
    bucketKey: `direct:surface:box:${width},${height},${depth}`,
    indices: new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
      12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]),
    mode: "triangles",
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    ]),
    positions: new Float32Array([
      -x, -y, z, x, -y, z, x, y, z, -x, y, z,
      x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z,
      -x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z,
      x, -y, z, x, -y, -z, x, y, -z, x, y, z,
      -x, y, z, x, y, z, x, y, -z, -x, y, -z,
      -x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z,
    ]),
    texCoords0: new Float32Array([
      ...faceUvs, ...faceUvs, ...faceUvs, ...faceUvs, ...faceUvs, ...faceUvs,
    ]),
  };
};

const normalizeDirectGeometry = (declaration: DirectGeometryDeclaration): CpuGeometry => {
  switch (declaration.geometry.kind) {
    case "box":
      return boxGeometry(declaration.geometry, declaration.topology);
    case "plane":
      return planeGeometry(declaration.geometry, declaration.topology);
  }
};

export const normalizeGeometryDeclaration = (declaration: GeometryDeclaration): CpuGeometry => {
  switch (declaration.kind) {
    case "direct-geometry":
      return normalizeDirectGeometry(declaration);
    case "gltf-geometry": {
      const geometry: Omit<CpuGeometry, "bucketKey"> = {
        ...(declaration.colors === undefined ? {} : { colors: declaration.colors }),
        ...(declaration.indices === undefined ? {} : { indices: declaration.indices }),
        mode: declaration.mode,
        ...(declaration.normals === undefined ? {} : { normals: declaration.normals }),
        positions: declaration.positions,
        ...(declaration.tangents === undefined ? {} : { tangents: declaration.tangents }),
        ...(declaration.texCoords0 === undefined ? {} : { texCoords0: declaration.texCoords0 }),
        ...(declaration.texCoords1 === undefined ? {} : { texCoords1: declaration.texCoords1 }),
      };
      return { ...geometry, bucketKey: geometryDeclarationBucketKey(declaration) };
    }
  }
};
