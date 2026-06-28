import type { GltfNode } from "@royal/renderer-core";
import { mat4 } from "gl-matrix";
import { createFloatBuffer, createIndexBuffer } from "./gl";
import { composeTransform, type Mat4 } from "./matrix";
import { markGltf, measureGltf } from "./performance";
import { TextureCache } from "./texture-cache";

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
  readonly model: Mat4;
  readonly normal: WebGLBuffer;
  readonly position: WebGLBuffer;
  readonly texCoord: WebGLBuffer;
  texture: WebGLTexture;
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

const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`Unsupported glTF: missing ${label}`);
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
  const accessor = required(json.accessors?.[accessorIndex], `accessor ${accessorIndex}`);
  if (accessor.componentType !== FLOAT || accessor.type !== expectedType) {
    throw new Error(`Unsupported glTF accessor ${accessorIndex}`);
  }

  const view = required(json.bufferViews?.[required(accessor.bufferView, `accessor ${accessorIndex} bufferView`)], `bufferView for accessor ${accessorIndex}`);
  if (view.byteStride !== undefined) {
    throw new Error("Unsupported glTF: interleaved accessors");
  }

  const buffer = required(buffers[view.buffer], `buffer ${view.buffer}`);
  const length = accessor.count * componentCount(accessor.type);
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return new Float32Array(buffer.slice(byteOffset, byteOffset + length * Float32Array.BYTES_PER_ELEMENT));
};

const copyIndexAccessor = (
  json: GltfJson,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number,
): Uint16Array => {
  const accessor = required(json.accessors?.[accessorIndex], `accessor ${accessorIndex}`);
  if (accessor.componentType !== UNSIGNED_SHORT || accessor.type !== "SCALAR") {
    throw new Error(`Unsupported glTF index accessor ${accessorIndex}`);
  }

  const view = required(json.bufferViews?.[required(accessor.bufferView, `accessor ${accessorIndex} bufferView`)], `bufferView for accessor ${accessorIndex}`);
  if (view.byteStride !== undefined) {
    throw new Error("Unsupported glTF: interleaved indices");
  }

  const buffer = required(buffers[view.buffer], `buffer ${view.buffer}`);
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

const loadJson = async (src: string): Promise<GltfJson> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Failed to load glTF: ${src}`);
  return await response.json() as GltfJson;
};

const loadBuffers = async (
  src: string,
  buffers: readonly GltfBuffer[],
): Promise<readonly ArrayBuffer[]> =>
  await Promise.all(buffers.map(async (buffer, index) => {
    const uri = required(buffer.uri, `buffer ${index} uri`);
    const response = await fetch(resolveUri(src, uri));
    if (!response.ok) throw new Error(`Failed to load glTF buffer: ${uri}`);
    return await response.arrayBuffer();
  }));

export class GltfCache {
  readonly #buffers = new Set<WebGLBuffer>();
  readonly #entries = new Map<string, GltfEntry>();
  readonly #gl: WebGLRenderingContext;
  readonly #onReady: () => void;
  readonly #textureCache: TextureCache;
  #disposed = false;

  constructor(gl: WebGLRenderingContext, onReady: () => void) {
    this.#gl = gl;
    this.#onReady = onReady;
    this.#textureCache = new TextureCache(gl);
  }

  get(node: GltfNode): GltfAsset | undefined {
    const entry = this.#entries.get(node.src);
    if (entry?.state === "ready") return entry.asset;
    if (entry?.state === "loading") return undefined;
    if (entry?.state === "error") throw entry.error;

    this.#entries.set(node.src, { state: "loading" });
    void this.#load(node.src).then((asset) => {
      if (this.#disposed) return;
      this.#entries.set(node.src, { asset, state: "ready" });
      this.#onReady();
    }).catch((error: unknown) => {
      if (this.#disposed) return;
      this.#entries.set(node.src, { error, state: "error" });
      this.#onReady();
    });
    return undefined;
  }

  getBounds(node: GltfNode): GltfAssetBounds | undefined {
    const entry = this.#entries.get(node.src);
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

  async #load(src: string): Promise<GltfAsset> {
    markGltf("document:start");
    const json = await loadJson(src);
    markGltf("document:end");
    measureGltf("document", "document:start", "document:end");

    const loadTexture = async (textureIndex: number): Promise<WebGLTexture> => {
      return await this.#textureCache.loadGltfBaseColorTexture({ json, src, textureIndex });
    };
    const warmedTextures = Promise.all(baseColorTextureIndices(json).map(loadTexture));
    void warmedTextures.catch(() => undefined);

    markGltf("buffers:start");
    const buffers = await loadBuffers(src, json.buffers ?? []);
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
        const attributes = required(primitive.attributes, "primitive attributes");
        const positionAccessor = required(attributes.POSITION, "POSITION accessor");
        const position = copyFloatAccessor(json, buffers, positionAccessor, "VEC3");
        const normal = copyFloatAccessor(json, buffers, required(attributes.NORMAL, "NORMAL accessor"), "VEC3");
        const texCoord = copyFloatAccessor(json, buffers, required(attributes.TEXCOORD_0, "TEXCOORD_0 accessor"), "VEC2");
        const indices = copyIndexAccessor(json, buffers, required(primitive.indices, "indices accessor"));
        const material = required(json.materials?.[required(primitive.material, "primitive material")], "primitive material");
        const textureIndex = required(material.pbrMetallicRoughness?.baseColorTexture?.index, "base color texture");
        const localBounds = accessorAabb(json, positionAccessor) ?? positionAabb(position);
        if (localBounds !== undefined) bounds = unionAabb(bounds, transformAabb(localBounds, model));

        const renderedPrimitive: GltfPrimitive = {
          index: this.#track(createIndexBuffer(this.#gl, indices)),
          indexCount: indices.length,
          model,
          normal: this.#track(createFloatBuffer(this.#gl, normal)),
          position: this.#track(createFloatBuffer(this.#gl, position)),
          texCoord: this.#track(createFloatBuffer(this.#gl, texCoord)),
          texture: this.#textureCache.getFallbackTexture(),
        };
        primitives.push(renderedPrimitive);
        textureLoads.push(loadTexture(textureIndex).then((texture) => {
          if (this.#disposed) return;
          renderedPrimitive.texture = texture;
          this.#onReady();
        }));
      }
    }

    markGltf("geometry-ready");
    void Promise.all([warmedTextures, ...textureLoads]).then(() => {
      markGltf("textures-ready");
    }).catch((error: unknown) => {
      if (this.#disposed) return;
      this.#entries.set(src, { error, state: "error" });
      this.#onReady();
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
