import type { GltfAssetRef, GltfNode } from "@royal/renderer-core";
import { mat4 } from "gl-matrix";
import { createFloatBuffer, createIndexBuffer, type RendererWebGlContext } from "./gl";
import { composeTransform, type Mat4 } from "./matrix";
import { markGltf, measureGltf } from "./performance";
import {
  TextureCache,
  type GltfBaseColorTexture,
  type GltfBaseColorTextureSource,
} from "./texture-cache";

type GltfAccessorType = "SCALAR" | "VEC2" | "VEC3";

type GltfAccessor = {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly max?: readonly number[];
  readonly min?: readonly number[];
  readonly type: GltfAccessorType;
};

type GltfBuffer = {
  readonly uri?: string;
};

type GltfBufferView = {
  readonly buffer: number;
  readonly byteLength: number;
  readonly byteOffset?: number;
  readonly byteStride?: number;
};

type GltfPrimitiveJson = {
  readonly attributes?: {
    readonly NORMAL?: number;
    readonly POSITION?: number;
    readonly TEXCOORD_0?: number;
  };
  readonly indices?: number;
  readonly material?: number;
};

type GltfMesh = {
  readonly primitives?: readonly GltfPrimitiveJson[];
};

type GltfMaterial = {
  readonly pbrMetallicRoughness?: {
    readonly baseColorTexture?: {
      readonly index: number;
    };
  };
};

type GltfTexture = {
  readonly source?: number;
};

type GltfImage = {
  readonly uri?: string;
};

type GltfNodeJson = {
  readonly matrix?: readonly number[];
  readonly mesh?: number;
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly translation?: readonly number[];
};

type GltfScene = {
  readonly nodes?: readonly number[];
};

type GltfJson = {
  readonly accessors?: readonly GltfAccessor[];
  readonly buffers?: readonly GltfBuffer[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly images?: readonly GltfImage[];
  readonly materials?: readonly GltfMaterial[];
  readonly meshes?: readonly GltfMesh[];
  readonly nodes?: readonly GltfNodeJson[];
  readonly scene?: number;
  readonly scenes?: readonly GltfScene[];
  readonly textures?: readonly GltfTexture[];
};

export type GltfPrimitive = {
  readonly index: WebGLBuffer;
  readonly indexCount: number;
  readonly material: GltfPrimitiveMaterial;
  readonly model: Mat4;
  readonly normal: WebGLBuffer;
  readonly position: WebGLBuffer;
  readonly texCoord: WebGLBuffer;
  texture: WebGLTexture;
};

export type GltfPrimitiveBaseColorTexture = {
  readonly identity: string;
  readonly source: GltfBaseColorTextureSource;
  state: "fallback" | "ready";
  texture: WebGLTexture;
};

export type GltfPrimitiveMaterial = {
  readonly baseColorTexture: GltfPrimitiveBaseColorTexture;
  readonly index: number;
};

export type GltfAssetBounds = {
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
};

export type GltfAsset = {
  readonly bounds?: GltfAssetBounds;
  readonly primitives: readonly GltfPrimitive[];
};

type GltfEntry =
  | { readonly error: unknown; readonly state: "error" }
  | { readonly state: "loading" }
  | { readonly asset: GltfAsset; readonly state: "ready" };

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

const unsupportedSubset = (reason: string): Error =>
  new Error(`Unsupported glTF subset: ${reason}`);

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Unsupported glTF: missing ${label}`);
  return value;
};

const requiredSubset = <T>(value: T | undefined, reason: string): T => {
  if (value === undefined) throw unsupportedSubset(reason);
  return value;
};

const baseColorTextureIndices = (json: GltfJson): readonly number[] => {
  const indices = new Set<number>();

  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const materialIndex = primitive.material;
      const textureIndex = materialIndex === undefined
        ? undefined
        : json.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
      if (textureIndex !== undefined) indices.add(textureIndex);
    }
  }

  return [...indices];
};

const componentCount = (type: GltfAccessorType): number => {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
  }
};

const copyFloatAccessor = (
  json: GltfJson,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number,
  expectedType: GltfAccessorType,
): Float32Array => {
  const accessor = requiredSubset(json.accessors?.[accessorIndex], `accessor ${accessorIndex} is missing`);
  if (accessor.componentType !== FLOAT || accessor.type !== expectedType) {
    throw unsupportedSubset(`accessor ${accessorIndex} must be FLOAT ${expectedType}`);
  }

  const viewIndex = requiredSubset(accessor.bufferView, `accessor ${accessorIndex} bufferView is required`);
  const view = requiredSubset(json.bufferViews?.[viewIndex], `bufferView ${viewIndex} for accessor ${accessorIndex} is missing`);
  if (view.byteStride !== undefined) {
    throw unsupportedSubset(`accessor ${accessorIndex} uses byteStride; interleaved accessors are not supported`);
  }

  const buffer = requiredSubset(buffers[view.buffer], `buffer ${view.buffer} is missing`);
  const length = accessor.count * componentCount(accessor.type);
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new Float32Array(buffer.slice(byteOffset, byteOffset + length * Float32Array.BYTES_PER_ELEMENT));
};

const copyIndexAccessor = (
  json: GltfJson,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number,
): Uint16Array => {
  const accessor = requiredSubset(json.accessors?.[accessorIndex], `accessor ${accessorIndex} is missing`);
  if (accessor.componentType !== UNSIGNED_SHORT || accessor.type !== "SCALAR") {
    throw unsupportedSubset(`index accessor ${accessorIndex} must be UNSIGNED_SHORT SCALAR`);
  }

  const viewIndex = requiredSubset(accessor.bufferView, `index accessor ${accessorIndex} bufferView is required`);
  const view = requiredSubset(json.bufferViews?.[viewIndex], `bufferView ${viewIndex} for index accessor ${accessorIndex} is missing`);
  if (view.byteStride !== undefined) {
    throw unsupportedSubset(`index accessor ${accessorIndex} uses byteStride; interleaved indices are not supported`);
  }

  const buffer = requiredSubset(buffers[view.buffer], `buffer ${view.buffer} is missing`);
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new Uint16Array(buffer.slice(byteOffset, byteOffset + accessor.count * Uint16Array.BYTES_PER_ELEMENT));
};

const accessorAabb = (
  json: GltfJson,
  accessorIndex: number,
): GltfAssetBounds | undefined => {
  const accessor = required(json.accessors?.[accessorIndex], `accessor ${accessorIndex}`);
  if (accessor.type !== "VEC3") return undefined;
  const min = accessor.min;
  const max = accessor.max;
  if (min === undefined || max === undefined) return undefined;
  if (min.length < 3 || max.length < 3) return undefined;
  if (!min.slice(0, 3).every(Number.isFinite) || !max.slice(0, 3).every(Number.isFinite)) {
    return undefined;
  }

  return {
    maxX: Math.max(min[0]!, max[0]!),
    maxY: Math.max(min[1]!, max[1]!),
    maxZ: Math.max(min[2]!, max[2]!),
    minX: Math.min(min[0]!, max[0]!),
    minY: Math.min(min[1]!, max[1]!),
    minZ: Math.min(min[2]!, max[2]!),
  };
};

const positionAabb = (position: Float32Array): GltfAssetBounds | undefined => {
  if (position.length < 3) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset + 2 < position.length; offset += 3) {
    const x = position[offset]!;
    const y = position[offset + 1]!;
    const z = position[offset + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return { maxX, maxY, maxZ, minX, minY, minZ };
};

const unionAabb = (
  a: GltfAssetBounds | undefined,
  b: GltfAssetBounds,
): GltfAssetBounds => {
  if (a === undefined) return b;
  return {
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
  };
};

const transformAabb = (bounds: GltfAssetBounds, matrix: Mat4): GltfAssetBounds => {
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

const nodeMatrix = (node: GltfNodeJson): Mat4 => {
  if (node.matrix !== undefined) {
    if (node.matrix.length !== 16) throw new Error("Unsupported glTF: invalid node matrix");
    return mat4.clone(node.matrix as Mat4);
  }

  const out = mat4.create();
  mat4.fromRotationTranslationScale(
    out,
    [
      node.rotation?.[0] ?? 0,
      node.rotation?.[1] ?? 0,
      node.rotation?.[2] ?? 0,
      node.rotation?.[3] ?? 1,
    ],
    [
      node.translation?.[0] ?? 0,
      node.translation?.[1] ?? 0,
      node.translation?.[2] ?? 0,
    ],
    [
      node.scale?.[0] ?? 1,
      node.scale?.[1] ?? 1,
      node.scale?.[2] ?? 1,
    ],
  );
  return out;
};

const resolveUri = (base: string, uri: string): string =>
  new URL(uri, new URL(base, globalThis.location?.href ?? "http://localhost/")).href;

const gltfCacheKey = (asset: GltfAssetRef): string =>
  `${asset.uri}\u0000${String(asset.revision ?? asset.uri)}`;

const looksLikeGlb = (src: string): boolean =>
  new URL(src, globalThis.location?.href ?? "http://localhost/").pathname.toLowerCase().endsWith(".glb");

const loadJson = async (src: string): Promise<GltfJson> => {
  if (looksLikeGlb(src)) {
    throw unsupportedSubset("JSON .gltf documents are required; GLB binary containers are not supported");
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to load glTF: ${src}`);
  if (response.headers.get("content-type")?.toLowerCase().includes("model/gltf-binary") === true) {
    throw unsupportedSubset("JSON .gltf documents are required; GLB binary containers are not supported");
  }

  try {
    return await response.json() as GltfJson;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw unsupportedSubset("JSON .gltf documents are required; GLB and non-JSON responses are not supported");
    }
    throw error;
  }
};

const loadBuffers = async (
  src: string,
  buffers: readonly GltfBuffer[],
): Promise<readonly ArrayBuffer[]> =>
  await Promise.all(buffers.map(async (buffer, index) => {
    const uri = requiredSubset(buffer.uri, `buffer ${index} must use an external buffer uri; GLB buffer chunks and embedded buffers are not supported`);
    if (uri.toLowerCase().startsWith("data:")) {
      throw unsupportedSubset(`buffer ${index} must use an external buffer uri; data URIs are not supported`);
    }
    const response = await fetch(resolveUri(src, uri));
    if (!response.ok) throw new Error(`Failed to load glTF buffer: ${uri}`);
    return await response.arrayBuffer();
  }));

export class GltfCache {
  readonly #buffers = new Set<WebGLBuffer>();
  readonly #entries = new Map<string, GltfEntry>();
  readonly #gl: RendererWebGlContext;
  readonly #onReady: () => void;
  readonly #textureCache: TextureCache;
  #disposed = false;

  constructor(gl: RendererWebGlContext, onReady: () => void) {
    this.#gl = gl;
    this.#onReady = onReady;
    this.#textureCache = new TextureCache(gl);
  }

  get(node: GltfNode): GltfAsset | undefined {
    const cacheKey = gltfCacheKey(node.asset);
    const entry = this.#entries.get(cacheKey);
    if (entry?.state === "ready") return entry.asset;
    if (entry?.state === "loading") return undefined;
    if (entry?.state === "error") throw entry.error;

    this.#entries.set(cacheKey, { state: "loading" });
    void this.#load(node.asset, cacheKey).then((asset) => {
      if (this.#disposed) return;
      this.#entries.set(cacheKey, { asset, state: "ready" });
      this.#onReady();
    }).catch((error: unknown) => {
      if (this.#disposed) return;
      this.#entries.set(cacheKey, { error, state: "error" });
      this.#onReady();
    });
    return undefined;
  }

  getBounds(node: GltfNode): GltfAssetBounds | undefined {
    const entry = this.#entries.get(gltfCacheKey(node.asset));
    if (entry?.state !== "ready") return undefined;
    if (entry.asset.bounds === undefined) return undefined;
    return transformAabb(entry.asset.bounds, composeTransform(node.transform));
  }

  dispose(): void {
    this.#disposed = true;
    for (const buffer of this.#buffers) {
      this.#gl.deleteBuffer(buffer);
    }
    this.#buffers.clear();
    this.#entries.clear();
    this.#textureCache.dispose();
  }

  async #load(asset: GltfAssetRef, cacheKey: string): Promise<GltfAsset> {
    const uri = asset.uri;
    markGltf("document:start");
    const json = await loadJson(uri);
    markGltf("document:end");
    measureGltf("document", "document:start", "document:end");

    const loadTexture = async (textureIndex: number): Promise<GltfBaseColorTexture> => {
      return await this.#textureCache.loadGltfBaseColorTexture({
        documentId: cacheKey,
        json,
        src: uri,
        textureIndex,
      });
    };
    const warmedTextures = Promise.all(baseColorTextureIndices(json).map(loadTexture));
    void warmedTextures.catch(() => undefined);

    markGltf("buffers:start");
    const buffers = await loadBuffers(uri, json.buffers ?? []);
    markGltf("buffers:end");
    measureGltf("buffers", "buffers:start", "buffers:end");

    const scene = required(json.scenes?.[json.scene ?? 0], "default scene");
    const primitives: GltfPrimitive[] = [];
    const textureLoads: Array<Promise<void>> = [];
    let bounds: GltfAssetBounds | undefined;

    for (const nodeIndex of scene.nodes ?? []) {
      const node = required(json.nodes?.[nodeIndex], `node ${nodeIndex}`);
      const meshIndex = required(node.mesh, `node ${nodeIndex} mesh`);
      const mesh = required(json.meshes?.[meshIndex], `mesh ${meshIndex}`);
      const model = nodeMatrix(node);

      for (const primitive of mesh.primitives ?? []) {
        const attributes = requiredSubset(primitive.attributes, "primitive attributes with POSITION, NORMAL, and TEXCOORD_0 are required");
        const positionAccessor = requiredSubset(attributes.POSITION, "primitive POSITION accessor is required");
        const position = copyFloatAccessor(json, buffers, positionAccessor, "VEC3");
        const normal = copyFloatAccessor(json, buffers, requiredSubset(attributes.NORMAL, "primitive NORMAL accessor is required"), "VEC3");
        const texCoord = copyFloatAccessor(json, buffers, requiredSubset(attributes.TEXCOORD_0, "primitive TEXCOORD_0 accessor is required"), "VEC2");
        const indices = copyIndexAccessor(json, buffers, requiredSubset(primitive.indices, "indexed primitives are required; unindexed primitives are not supported"));
        const materialIndex = requiredSubset(primitive.material, "primitive material with pbrMetallicRoughness.baseColorTexture is required");
        const material = requiredSubset(json.materials?.[materialIndex], `material ${materialIndex} is missing`);
        const textureIndex = requiredSubset(material.pbrMetallicRoughness?.baseColorTexture?.index, `material ${materialIndex} pbrMetallicRoughness.baseColorTexture is required`);
        const textureSource = this.#textureCache.getGltfBaseColorTextureSource({
          documentId: cacheKey,
          json,
          src: uri,
          textureIndex,
        });
        const localBounds = accessorAabb(json, positionAccessor) ?? positionAabb(position);
        if (localBounds !== undefined) bounds = unionAabb(bounds, transformAabb(localBounds, model));

        const fallbackTexture = this.#textureCache.getFallbackTexture();
        const baseColorTexture: GltfPrimitiveBaseColorTexture = {
          identity: textureSource.id,
          source: textureSource,
          state: "fallback",
          texture: fallbackTexture,
        };
        const renderedPrimitive: GltfPrimitive = {
          index: this.#track(createIndexBuffer(this.#gl, indices)),
          indexCount: indices.length,
          material: {
            baseColorTexture,
            index: materialIndex,
          },
          model,
          normal: this.#track(createFloatBuffer(this.#gl, normal)),
          position: this.#track(createFloatBuffer(this.#gl, position)),
          texCoord: this.#track(createFloatBuffer(this.#gl, texCoord)),
          texture: fallbackTexture,
        };
        primitives.push(renderedPrimitive);
        textureLoads.push(loadTexture(textureIndex).then((texture) => {
          if (this.#disposed) return;
          baseColorTexture.state = "ready";
          baseColorTexture.texture = texture.texture;
          renderedPrimitive.texture = texture.texture;
          this.#onReady();
        }));
      }
    }

    markGltf("geometry-ready");
    void Promise.allSettled([warmedTextures, ...textureLoads]).then(() => {
      markGltf("textures-ready");
    });
    return bounds === undefined ? { primitives } : { bounds, primitives };
  }

  #track(buffer: WebGLBuffer): WebGLBuffer {
    if (this.#disposed) {
      this.#gl.deleteBuffer(buffer);
      return buffer;
    }

    this.#buffers.add(buffer);
    return buffer;
  }

}
