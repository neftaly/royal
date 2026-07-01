import type {
  AutoLodNode,
  AutoLodQuality,
  BoxGeometry,
  Camera,
  DirectionalLightNode,
  GltfNode,
  Material,
  MeshNode,
  PlaneGeometry,
  RenderNode,
  RenderRoot,
  Rgba,
  StandardMaterial,
  TextNode,
  TextureSampler,
  TextureRef,
  Transform,
  UnlitMaterial,
  Vec3,
} from "@royal/renderer-core";
import { textMesh } from "@royal/renderer-core/text";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

type NormalizedWebGlRootOptions = Required<WebGlRootOptions>;

/** Snapshot of renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly diagnostics: readonly string[];
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: NormalizedWebGlRootOptions;
}

type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

type ProgramKind = "surface" | "wireframe";

type ProgramResource = {
  readonly fragmentShader: WebGLShader;
  readonly program: WebGLProgram;
  readonly vertexShader: WebGLShader;
};

type GeometryResource = {
  readonly arrayBuffer: WebGLBuffer;
  readonly borrowedVertexBufferKey?: string;
  readonly drawCount: number;
  readonly indexBuffer?: WebGLBuffer;
  readonly indexType?: number;
  readonly key: string;
  readonly mode: "lines" | "triangles";
  readonly normalBuffer?: WebGLBuffer;
  readonly texCoordBuffer?: WebGLBuffer;
};

type CpuGeometry = {
  readonly indices?: Uint16Array | Uint32Array | Uint8Array;
  readonly key: string;
  readonly mode: "lines" | "triangles";
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array;
  readonly vertexBufferKey?: string;
};

type TextureResource = {
  readonly key: string;
  readonly texture: WebGLTexture;
  uploaded: boolean;
};

type TextureLoadState = TextureResource & {
  error?: string;
  loading: boolean;
};

type TextureAssetUploadRef = Extract<TextureRef, { readonly kind: "asset" }> & {
  readonly flipY?: boolean;
};

type LoadedGltfPrimitive = {
  readonly generatedLod?: GeneratedGltfPrimitiveLod;
  readonly indices: Uint16Array | Uint32Array | Uint8Array;
  readonly key: string;
  readonly material: LoadedGltfMaterial;
  readonly materialLod?: GltfMaterialPrimitiveLod;
  readonly model: Mat4;
  readonly nodeLod?: GltfNodePrimitiveLod;
  readonly normals?: Float32Array;
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array;
};

type GeneratedGltfPrimitiveLod = {
  readonly diagnostic?: string;
  levels: readonly GeneratedGltfPrimitiveLodLevel[];
  diagnosticRecorded: boolean;
  scheduled: boolean;
  status: "pending" | "ready" | "unsupported";
};

type GeneratedGltfPrimitiveLodLevel = {
  readonly indices: Uint16Array | Uint32Array | Uint8Array;
  readonly level: number;
  readonly stride: number;
};

type LoadedGltfMaterial = {
  readonly baseColorImageUri?: string;
  readonly baseColorTextureUri?: string;
  readonly color?: Rgba;
  readonly image?: HTMLImageElement | ImageBitmap;
  readonly imageFailed?: boolean;
  readonly sampler?: TextureSampler;
};

type GltfNodePrimitiveLod = {
  readonly group: string;
  readonly level: number;
  readonly levelCount: number;
  readonly thresholds: readonly number[];
};

type GltfMaterialPrimitiveLod = {
  readonly levels: readonly LoadedGltfMaterial[];
  readonly thresholds: readonly number[];
};

type GltfLodSelectionState = {
  readonly level: number;
};

type GltfState = {
  readonly key: string;
  error?: string;
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
};

type AutoLodPolicy = {
  readonly generatedMeshes: "off" | "experimental";
  readonly quality: AutoLodQuality;
};

type GltfDocument = {
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly buffers?: readonly GltfBuffer[];
  readonly images?: readonly GltfImage[];
  readonly materials?: readonly GltfMaterial[];
  readonly meshes?: readonly GltfMesh[];
  readonly nodes?: readonly GltfSceneNode[];
  readonly samplers?: readonly GltfSampler[];
  readonly scene?: number;
  readonly scenes?: readonly GltfScene[];
  readonly textures?: readonly GltfTexture[];
};

type GltfAccessor = {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly sparse?: unknown;
  readonly type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
};

type GltfBufferView = {
  readonly buffer?: number;
  readonly byteLength: number;
  readonly byteOffset?: number;
  readonly byteStride?: number;
};

type GltfBuffer = {
  readonly uri?: string;
};

type GltfImage = {
  readonly bufferView?: number;
  readonly mimeType?: string;
  readonly uri?: string;
};

type GltfSampler = {
  readonly magFilter?: number;
  readonly minFilter?: number;
  readonly wrapS?: number;
  readonly wrapT?: number;
};

type GltfMaterial = {
  readonly extensions?: {
    readonly MSFT_lod?: GltfLodExtension;
  };
  readonly extras?: GltfLodExtras;
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: readonly number[];
    readonly baseColorTexture?: {
      readonly index?: number;
    };
  };
};

type GltfMesh = {
  readonly primitives?: readonly GltfMeshPrimitive[];
  readonly weights?: readonly number[];
};

type GltfMeshPrimitive = {
  readonly attributes?: {
    readonly NORMAL?: number;
    readonly POSITION?: number;
    readonly TEXCOORD_0?: number;
    readonly [semantic: string]: number | undefined;
  };
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
  readonly targets?: readonly unknown[];
};

type GltfSceneNode = {
  readonly extensions?: {
    readonly MSFT_lod?: GltfLodExtension;
  };
  readonly extras?: GltfLodExtras;
  readonly matrix?: readonly number[];
  readonly mesh?: number;
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly skin?: number;
  readonly translation?: readonly number[];
};

type GltfLodExtension = {
  readonly ids?: readonly number[];
};

type GltfLodExtras = {
  readonly MSFT_screencoverage?: readonly number[];
};

type GltfScene = {
  readonly nodes?: readonly number[];
};

type GltfTexture = {
  readonly sampler?: number;
  readonly source?: number;
};

type MinimalVirtualTextureManifest = {
  readonly pages?: unknown;
};

const DEFAULT_COLOR: Rgba = [1, 1, 1, 1];
const DEFAULT_LIGHT_COLOR: Rgba = [1, 1, 1, 1];
const DEFAULT_LIGHT_DIRECTION: Vec3 = [0, -1, 0];
const GLTF_LOD_HYSTERESIS_RATIO = 0.15;
const GENERATED_GLTF_LOD_THRESHOLDS = [0.2, 0.05, 0] as const;
const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const normalizeOptions = (options: WebGlRootOptions = {}): NormalizedWebGlRootOptions => {
  return {
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  };
};

const identityMat4 = (): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const multiplyMat4 = (left: Mat4, right: Mat4): Mat4 => {
  const out: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ] = [
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[row]! * right[column * 4]!
        + left[4 + row]! * right[column * 4 + 1]!
        + left[8 + row]! * right[column * 4 + 2]!
        + left[12 + row]! * right[column * 4 + 3]!;
    }
  }

  return out;
};

const translationMat4 = ([x, y, z]: Vec3): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

const scaleMat4 = ([x, y, z]: Vec3): Mat4 => [
  x, 0, 0, 0,
  0, y, 0, 0,
  0, 0, z, 0,
  0, 0, 0, 1,
];

const rotationXMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
};

const rotationYMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
};

const rotationZMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
};

const transformMat4 = (transform: Transform | undefined): Mat4 => {
  const actual = transform ?? IDENTITY_TRANSFORM;
  return multiplyMat4(
    translationMat4(actual.position),
    multiplyMat4(
      rotationZMat4(actual.rotation[2]),
      multiplyMat4(
        rotationYMat4(actual.rotation[1]),
        multiplyMat4(rotationXMat4(actual.rotation[0]), scaleMat4(actual.scale)),
      ),
    ),
  );
};

const quaternionMat4 = (rotation: readonly number[] | undefined): Mat4 => {
  const x = rotation?.[0] ?? 0;
  const y = rotation?.[1] ?? 0;
  const z = rotation?.[2] ?? 0;
  const w = rotation?.[3] ?? 1;
  const length = Math.hypot(x, y, z, w) || 1;
  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  const nw = w / length;
  const xx = nx * nx;
  const xy = nx * ny;
  const xz = nx * nz;
  const xw = nx * nw;
  const yy = ny * ny;
  const yz = ny * nz;
  const yw = ny * nw;
  const zz = nz * nz;
  const zw = nz * nw;

  return [
    1 - 2 * (yy + zz), 2 * (xy + zw), 2 * (xz - yw), 0,
    2 * (xy - zw), 1 - 2 * (xx + zz), 2 * (yz + xw), 0,
    2 * (xz + yw), 2 * (yz - xw), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ];
};

const gltfNodeMat4 = (node: GltfSceneNode | undefined): Mat4 => {
  if (node?.matrix !== undefined && node.matrix.length === 16) {
    return [
      node.matrix[0]!, node.matrix[1]!, node.matrix[2]!, node.matrix[3]!,
      node.matrix[4]!, node.matrix[5]!, node.matrix[6]!, node.matrix[7]!,
      node.matrix[8]!, node.matrix[9]!, node.matrix[10]!, node.matrix[11]!,
      node.matrix[12]!, node.matrix[13]!, node.matrix[14]!, node.matrix[15]!,
    ];
  }

  const translation = node?.translation;
  const scale = node?.scale;
  return multiplyMat4(
    translationMat4([
      translation?.[0] ?? 0,
      translation?.[1] ?? 0,
      translation?.[2] ?? 0,
    ]),
    multiplyMat4(
      quaternionMat4(node?.rotation),
      scaleMat4([
        scale?.[0] ?? 1,
        scale?.[1] ?? 1,
        scale?.[2] ?? 1,
      ]),
    ),
  );
};

const viewMat4 = (camera: Camera): Mat4 => multiplyMat4(
  multiplyMat4(
    multiplyMat4(
      rotationXMat4(-camera.rotation[0]),
      rotationYMat4(-camera.rotation[1]),
    ),
    rotationZMat4(-camera.rotation[2]),
  ),
  translationMat4([-camera.position[0], -camera.position[1], -camera.position[2]]),
);

const projectionMat4 = (camera: Camera, width: number, height: number): Mat4 => {
  if (camera.kind === "orthographic-camera") {
    const { bottom, far, left, near, right, top } = camera;
    return [
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
    ];
  }

  const aspect = width / Math.max(1, height);
  const f = 1 / Math.tan(camera.fovY / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (camera.far + camera.near) / (camera.near - camera.far), -1,
    0, 0, (2 * camera.far * camera.near) / (camera.near - camera.far), 0,
  ];
};

const textureKey = (texture: TextureRef): string => {
  if (texture.kind === "solid") {
    return `solid:${texture.color.join(",")}:${texture.colorSpace ?? ""}:${texture.version ?? ""}`;
  }
  if (texture.kind === "asset") {
    const sampler = texture.sampler;
    const upload = texture as TextureAssetUploadRef;
    return [
      "asset",
      texture.uri,
      texture.version ?? "",
      texture.colorSpace ?? "",
      sampler?.magFilter ?? "",
      sampler?.minFilter ?? "",
      sampler?.wrapS ?? "",
      sampler?.wrapT ?? "",
      upload.flipY === false ? "flipY:false" : "",
    ].join(":");
  }

  const sampler = texture.sampler;
  return [
    "virtual",
    texture.manifestUri,
    texture.version ?? "",
    texture.colorSpace ?? "",
    sampler?.magFilter ?? "",
    sampler?.minFilter ?? "",
    sampler?.wrapS ?? "",
    sampler?.wrapT ?? "",
    texture.preview === undefined ? "" : textureKey(texture.preview),
  ].join(":");
};

const materialColor = (material: Material): Rgba => {
  const texture = material.baseColor;
  if (texture.kind === "solid") return texture.color;
  if (texture.kind === "virtual-asset") return texture.fallback?.color ?? texture.preview?.fallback?.color ?? [0.5, 0.5, 0.5, 1];

  return texture.fallback?.color ?? [0.5, 0.5, 0.5, 1];
};

const resolveUrl = (base: string, relative: string): string => {
  if (/^(?:[a-z]+:)?\/\//iu.test(relative) || relative.startsWith("/")) return relative;
  const index = base.lastIndexOf("/");
  return `${index < 0 ? "" : base.slice(0, index + 1)}${relative}`;
};

const samplerConstant = (
  gl: WebGL2RenderingContext,
  value: string | undefined,
  fallback: number,
): number => {
  switch (value) {
    case "clamp-to-edge":
      return gl.CLAMP_TO_EDGE;
    case "linear":
      return gl.LINEAR;
    case "linear-mipmap-linear":
      return gl.LINEAR_MIPMAP_LINEAR;
    case "linear-mipmap-nearest":
      return gl.LINEAR_MIPMAP_NEAREST;
    case "mirrored-repeat":
      return gl.MIRRORED_REPEAT;
    case "nearest":
      return gl.NEAREST;
    case "nearest-mipmap-linear":
      return gl.NEAREST_MIPMAP_LINEAR;
    case "nearest-mipmap-nearest":
      return gl.NEAREST_MIPMAP_NEAREST;
    case "repeat":
      return gl.REPEAT;
    default:
      return fallback;
  }
};

const gltfSamplerMagFilter = (value: number | undefined): NonNullable<TextureSampler["magFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    case 9729:
    default:
      return "linear";
  }
};

const gltfSamplerMinFilter = (value: number | undefined): NonNullable<TextureSampler["minFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    case 9729:
      return "linear";
    case 9984:
      return "nearest-mipmap-nearest";
    case 9985:
      return "linear-mipmap-nearest";
    case 9986:
      return "nearest-mipmap-linear";
    case 9987:
    default:
      return "linear-mipmap-linear";
  }
};

const gltfSamplerWrap = (value: number | undefined): NonNullable<TextureSampler["wrapS"]> => {
  switch (value) {
    case 33071:
      return "clamp-to-edge";
    case 33648:
      return "mirrored-repeat";
    case 10497:
    default:
      return "repeat";
  }
};

const gltfTextureSampler = (sampler: GltfSampler | undefined): TextureSampler => ({
  magFilter: gltfSamplerMagFilter(sampler?.magFilter),
  minFilter: gltfSamplerMinFilter(sampler?.minFilter),
  wrapS: gltfSamplerWrap(sampler?.wrapS),
  wrapT: gltfSamplerWrap(sampler?.wrapT),
});

const gltfTextureIdentity = (
  assetKey: string,
  src: string,
  textureIndex: number,
  imageIndex: number | undefined,
  image: GltfImage,
): string => {
  if (image.uri !== undefined) return `${assetKey}:image-uri:${resolveUrl(src, image.uri)}`;
  if (image.bufferView !== undefined) {
    return `${assetKey}:image-buffer-view:${image.bufferView}:${image.mimeType ?? ""}`;
  }

  return `${assetKey}:texture-index:${textureIndex}:image-index:${imageIndex ?? ""}`;
};

const usesMipmaps = (value: string | undefined): boolean =>
  value === "linear-mipmap-linear"
  || value === "linear-mipmap-nearest"
  || value === "nearest-mipmap-linear"
  || value === "nearest-mipmap-nearest";

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const ImageConstructor = globalThis.Image;
  if (ImageConstructor === undefined) {
    reject(new Error(`Image loading is unavailable for texture ${src}`));
    return;
  }

  const image = new ImageConstructor();
  image.crossOrigin = "anonymous";

  const cleanup = (): void => {
    image.removeEventListener("load", onLoad);
    image.removeEventListener("error", onError);
  };
  const onLoad = (): void => {
    const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
    decoded.then(() => {
      cleanup();
      resolve(image);
    }, (error: unknown) => {
      cleanup();
      reject(error);
    });
  };
  const onError = (event: Event): void => {
    cleanup();
    const message = "message" in event && typeof event.message === "string"
      ? event.message
      : `Image load failed for ${src}`;
    reject(new Error(message));
  };

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  image.src = src;

  if (image.complete) onLoad();
});

const loadFetchedImage = async (src: string): Promise<HTMLImageElement | ImageBitmap> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  if (typeof globalThis.createImageBitmap === "function" && typeof response.blob === "function") {
    return await globalThis.createImageBitmap(await response.blob());
  }

  return await loadImage(src);
};

const getNodeKind = (node: RenderNode): string =>
  typeof node === "object" && node !== null && "kind" in node && typeof node.kind === "string"
    ? node.kind
    : "unknown";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstManifestEntryUri = (entries: unknown): string | undefined => {
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (typeof entry.uri === "string" && entry.uri.length > 0) return entry.uri;
    }
    return undefined;
  }

  if (!isRecord(entries)) return undefined;
  for (const uri of Object.values(entries)) {
    if (typeof uri === "string" && uri.length > 0) return uri;
  }
  return undefined;
};

const templateManifestPageUri = (template: string): string =>
  template
    .replaceAll("{page}", "m0/0/0")
    .replaceAll("{mip}", "0")
    .replaceAll("{x}", "0")
    .replaceAll("{y}", "0");

const firstVirtualTexturePageUri = (manifest: MinimalVirtualTextureManifest): string | undefined => {
  if (Array.isArray(manifest.pages)) return firstManifestEntryUri(manifest.pages);
  if (!isRecord(manifest.pages)) return undefined;

  const explicit = firstManifestEntryUri(manifest.pages.entries);
  if (explicit !== undefined) return explicit;
  return typeof manifest.pages.uriTemplate === "string" && manifest.pages.uriTemplate.length > 0
    ? templateManifestPageUri(manifest.pages.uriTemplate)
    : undefined;
};

const componentCount = (type: GltfAccessor["type"]): number => {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
      return 4;
  }
};

const gltfColor = (values: readonly number[] | undefined): Rgba | undefined => {
  if (values === undefined || values.length < 3) return undefined;

  return [
    values[0] ?? 1,
    values[1] ?? 1,
    values[2] ?? 1,
    values[3] ?? 1,
  ];
};

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

const fallbackLodThreshold = (level: number, levelCount: number): number =>
  level >= levelCount - 1 ? 0 : 0.2 / (4 ** level);

const gltfLodThresholds = (
  extras: GltfLodExtras | undefined,
  levelCount: number,
): readonly number[] => {
  const thresholds: number[] = [];
  let previous = 1;
  for (let level = 0; level < levelCount; level += 1) {
    const value = extras?.MSFT_screencoverage?.[level];
    const threshold = Number.isFinite(value)
      ? clamp01(value as number)
      : fallbackLodThreshold(level, levelCount);
    const ordered = Math.min(previous, threshold);
    thresholds.push(ordered);
    previous = ordered;
  }

  return thresholds;
};

const selectedLodLevel = (
  coverage: number,
  levelCount: number,
  thresholds: readonly number[],
): number | undefined => {
  for (let level = 0; level < levelCount; level += 1) {
    if (coverage >= (thresholds[level] ?? fallbackLodThreshold(level, levelCount))) return level;
  }

  return undefined;
};

const hystereticLodLevel = (
  coverage: number,
  levelCount: number,
  thresholds: readonly number[],
  previousLevel: number | undefined,
): number => {
  const stateless = selectedLodLevel(coverage, levelCount, thresholds) ?? levelCount - 1;
  if (
    previousLevel === undefined
    || previousLevel < 0
    || previousLevel >= levelCount
  ) {
    return stateless;
  }

  let level = previousLevel;
  while (level > 0) {
    const threshold = thresholds[level - 1] ?? fallbackLodThreshold(level - 1, levelCount);
    if (coverage < Math.min(1, threshold * (1 + GLTF_LOD_HYSTERESIS_RATIO))) break;
    level -= 1;
  }
  while (level < levelCount - 1) {
    const threshold = thresholds[level] ?? fallbackLodThreshold(level, levelCount);
    if (coverage >= threshold * (1 - GLTF_LOD_HYSTERESIS_RATIO)) break;
    level += 1;
  }

  return level;
};

const adjacentLodLevels = (level: number, levelCount: number): readonly number[] => {
  const levels: number[] = [];
  if (level > 0) levels.push(level - 1);
  if (level + 1 < levelCount) levels.push(level + 1);
  return levels;
};

const copyIndexArray = (
  indices: Uint16Array | Uint32Array | Uint8Array,
  values: readonly number[],
): Uint16Array | Uint32Array | Uint8Array => {
  if (indices instanceof Uint32Array) return new Uint32Array(values);
  if (indices instanceof Uint8Array) return new Uint8Array(values);

  return new Uint16Array(values);
};

const generatedGltfIndexLodLevel = (
  indices: Uint16Array | Uint32Array | Uint8Array,
  level: number,
  stride: number,
): GeneratedGltfPrimitiveLodLevel => {
  const reduced: number[] = [];
  const triangleCount = Math.floor(indices.length / 3);
  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const offset = triangle * 3;
    reduced.push(indices[offset]!, indices[offset + 1]!, indices[offset + 2]!);
  }
  if (reduced.length === 0 && indices.length >= 3) {
    reduced.push(indices[0]!, indices[1]!, indices[2]!);
  }

  return {
    indices: copyIndexArray(indices, reduced),
    level,
    stride,
  };
};

const generatedGltfIndexLodLevels = (
  indices: Uint16Array | Uint32Array | Uint8Array,
): readonly GeneratedGltfPrimitiveLodLevel[] => [
  generatedGltfIndexLodLevel(indices, 1, 2),
  generatedGltfIndexLodLevel(indices, 2, 4),
];

const projectedScreenCoverage = (
  positions: Float32Array,
  model: Mat4,
  projection: Mat4,
  view: Mat4,
): number => {
  if (positions.length === 0) return 0;

  const mvp = multiplyMat4(projection, multiplyMat4(view, model));
  let minX = 1;
  let minY = 1;
  let maxX = -1;
  let maxY = -1;
  let projected = false;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (clipW === 0) continue;

    const ndcX = clamp01((clipX / clipW + 1) / 2);
    const ndcY = clamp01((clipY / clipW + 1) / 2);
    minX = Math.min(minX, ndcX);
    minY = Math.min(minY, ndcY);
    maxX = Math.max(maxX, ndcX);
    maxY = Math.max(maxY, ndcY);
    projected = true;
  }

  if (!projected) return 0;

  return clamp01((maxX - minX) * (maxY - minY));
};

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
export class WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: NormalizedWebGlRootOptions;
  readonly #programs = new Map<ProgramKind, ProgramResource>();
  readonly #geometry = new Map<string, GeometryResource>();
  readonly #textures = new Map<string, TextureResource | TextureLoadState>();
  readonly #gltf = new Map<string, GltfState>();
  readonly #gltfLodSelections = new Map<string, GltfLodSelectionState>();
  readonly #ownedBuffers = new Set<WebGLBuffer>();
  readonly #ownedPrograms = new Set<WebGLProgram>();
  readonly #ownedShaders = new Set<WebGLShader>();
  readonly #ownedTextures = new Set<WebGLTexture>();
  #activeGltfLodSelectionKeys = new Set<string>();
  #dprMediaQuery: MediaQueryList | undefined;
  #diagnostics: string[] = [];
  #disposed = false;
  #frame = 0;
  #gltfRenderOrdinal = 0;
  #latestScene: RenderRoot | undefined;
  #renderScheduled = false;
  #resizeObserver: ResizeObserver | undefined;
  readonly #viewportInvalidationListener = (): void => {
    this.#scheduleRender();
  };

  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
    this.#canvas = canvas;
    this.#options = normalizeOptions(options);
    const gl = canvas.getContext("webgl2", this.#options) as WebGL2RenderingContext | null;
    if (gl === null) {
      throw new Error("Royal WebGL renderer requires a WebGL2 context");
    }
    this.#gl = gl;
    this.#watchViewport();
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get frame(): number {
    return this.#frame;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#latestScene;
  }

  get options(): NormalizedWebGlRootOptions {
    return this.#options;
  }

  render(scene: RenderRoot): void {
    if (this.#disposed) {
      throw new Error("Cannot render with a disposed Royal renderer root");
    }

    this.#latestScene = scene;
    this.#activeGltfLodSelectionKeys = new Set();
    this.#gltfRenderOrdinal = 0;
    const { height, width } = this.#resize();
    const gl = this.#gl;
    gl.viewport(0, 0, width, height);
    gl.clearDepth?.(1);
    gl.enable?.(gl.DEPTH_TEST);
    gl.depthFunc?.(gl.LEQUAL);
    gl.enable?.(gl.BLEND);
    gl.blendFunc?.(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const usedGeometry = new Set<string>();
    for (const renderPass of scene.children) {
      const [r, g, b, a] = renderPass.clearColor;
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const projection = projectionMat4(renderPass.camera, width, height);
      const view = viewMat4(renderPass.camera);
      const lights = this.#directionalLights(renderPass.children);

      for (const child of renderPass.children) {
        if (child.kind === "directional-light") continue;
        this.#drawNode(child, projection, view, lights[0], usedGeometry);
      }
    }

    this.#releaseUnusedGeometry(usedGeometry);
    this.#pruneGltfLodSelections();
    this.#frame += 1;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    const gl = this.#gl;
    for (const buffer of Array.from(this.#ownedBuffers)) this.#deleteBuffer(buffer);
    for (const texture of Array.from(this.#ownedTextures)) {
      gl.deleteTexture(texture);
      this.#ownedTextures.delete(texture);
    }
    for (const program of Array.from(this.#ownedPrograms)) {
      gl.deleteProgram(program);
      this.#ownedPrograms.delete(program);
    }
    for (const shader of Array.from(this.#ownedShaders)) {
      gl.deleteShader(shader);
      this.#ownedShaders.delete(shader);
    }

    this.#programs.clear();
    this.#geometry.clear();
    this.#textures.clear();
    this.#gltf.clear();
    this.#gltfLodSelections.clear();
    this.#activeGltfLodSelectionKeys.clear();
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#dprMediaQuery?.removeEventListener?.("change", this.#viewportInvalidationListener);
    this.#dprMediaQuery?.removeListener?.(this.#viewportInvalidationListener);
    this.#dprMediaQuery = undefined;
  }

  snapshot(): WebGlRootSnapshot {
    return {
      diagnostics: [...this.#diagnostics],
      disposed: this.#disposed,
      frame: this.#frame,
      latestScene: this.#latestScene,
      options: { ...this.#options },
    };
  }

  #resize(): { readonly height: number; readonly width: number } {
    const rect = this.#canvas.getBoundingClientRect?.();
    const cssWidth = rect?.width ?? this.#canvas.clientWidth;
    const cssHeight = rect?.height ?? this.#canvas.clientHeight;
    const dpr = globalThis.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;

    return { height, width };
  }

  #watchViewport(): void {
    const ResizeObserverConstructor = globalThis.ResizeObserver;
    if (typeof ResizeObserverConstructor === "function") {
      this.#resizeObserver = new ResizeObserverConstructor(this.#viewportInvalidationListener);
      this.#resizeObserver.observe(this.#canvas);
    }

    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia === "function") {
      this.#dprMediaQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
      this.#dprMediaQuery.addEventListener?.("change", this.#viewportInvalidationListener);
      this.#dprMediaQuery.addListener?.(this.#viewportInvalidationListener);
    }
  }

  #drawNode(
    node: RenderNode,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
    autoLodPolicy?: AutoLodPolicy,
  ): void {
    switch (node.kind) {
      case "auto-lod":
        this.#drawAutoLod(node, projection, view, light, usedGeometry);
        return;
      case "directional-light":
        return;
      case "mesh":
        this.#drawMesh(node, projection, view, light, usedGeometry);
        return;
      case "text":
        this.#drawText(node, projection, view, usedGeometry);
        return;
      case "gltf":
        this.#drawGltf(node, projection, view, light, usedGeometry, autoLodPolicy);
        return;
      default:
        this.#recordDiagnostic(`Unsupported render node kind "${getNodeKind(node)}"`);
    }
  }

  #directionalLights(nodes: readonly RenderNode[]): readonly DirectionalLightNode[] {
    const lights: DirectionalLightNode[] = [];
    for (const node of nodes) {
      if (node.kind === "directional-light") {
        lights.push(node);
      } else if (node.kind === "auto-lod") {
        lights.push(...this.#directionalLights(node.children));
      }
    }

    return lights;
  }

  #drawAutoLod(
    node: AutoLodNode,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
  ): void {
    const policy: AutoLodPolicy = {
      generatedMeshes: node.generatedMeshes,
      quality: node.quality,
    };
    for (const child of node.children) {
      this.#drawNode(child, projection, view, light, usedGeometry, policy);
    }
  }

  #drawMesh(
    node: MeshNode,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
  ): void {
    const cpu = this.#meshGeometry(node.geometry, node.material);
    const model = transformMat4(node.transform);
    if (!this.#isVisible(cpu.positions, model, projection, view)) return;
    if (node.material.kind === "standard" && light === undefined) {
      throw new Error("standardMaterial meshes require a directionalLight in the render pass");
    }
    const gpu = this.#geometryResource(cpu);
    usedGeometry.add(gpu.key);
    this.#drawGeometry(gpu, node.material, model, projection, view, light);
  }

  #drawText(
    node: TextNode,
    projection: Mat4,
    view: Mat4,
    usedGeometry: Set<string>,
  ): void {
    const mesh = textMesh(node);
    if (mesh.vertices.length === 0 || mesh.indices.length === 0) return;

    const positions = new Float32Array(mesh.vertices.length * 3);
    const texCoords = new Float32Array(mesh.vertices.length * 2);
    for (const [index, vertex] of mesh.vertices.entries()) {
      positions[index * 3] = vertex.position[0];
      positions[index * 3 + 1] = vertex.position[1];
      positions[index * 3 + 2] = vertex.position[2];
      texCoords[index * 2] = vertex.glyphCoord[0];
      texCoords[index * 2 + 1] = vertex.glyphCoord[1];
    }
    const indices = mesh.vertices.length > 65535
      ? new Uint32Array(mesh.indices)
      : new Uint16Array(mesh.indices);
    const cpu: CpuGeometry = {
      indices,
      key: `text:${node.layout.source}:${node.layout.font.metrics.size}:${mesh.vertices.length}:${mesh.indices.length}`,
      mode: "triangles",
      positions,
      texCoords,
    };
    const gpu = this.#geometryResource(cpu);
    const material: UnlitMaterial = {
      baseColor: { color: node.color, kind: "solid" },
      kind: "unlit",
    };
    usedGeometry.add(gpu.key);
    this.#drawGeometry(gpu, material, identityMat4(), projection, view, undefined);
  }

  #drawGltf(
    node: GltfNode,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
    autoLodPolicy: AutoLodPolicy | undefined,
  ): void {
    const renderInstanceKey = `instance:${this.#gltfRenderOrdinal}`;
    this.#gltfRenderOrdinal += 1;
    const state = this.#gltfState(node);
    if (state.status !== "ready") return;

    const rootModel = transformMat4(node.transform);
    const selectedNodeLevels = this.#selectedGltfNodeLodLevels(
      state,
      renderInstanceKey,
      rootModel,
      projection,
      view,
    );
    this.#preloadAdjacentGltfNodeLodTextures(state.primitives, selectedNodeLevels);
    for (const primitive of state.primitives) {
      const nodeLod = primitive.nodeLod;
      if (nodeLod !== undefined) {
        const selectedLevel = selectedNodeLevels.get(nodeLod.group);
        if (selectedLevel !== nodeLod.level) continue;
      }

      const model = multiplyMat4(rootModel, primitive.model);
      const materialSelection = this.#selectedGltfMaterial(
        state,
        renderInstanceKey,
        primitive,
        model,
        projection,
        view,
      );
      const loadedMaterial = materialSelection.material;
      this.#preloadAdjacentGltfMaterialLodTextures(primitive.materialLod, materialSelection.level);

      let material: StandardMaterial = {
        baseColor: { color: loadedMaterial.color ?? DEFAULT_COLOR, kind: "solid" },
        kind: "standard",
      };
      const baseColor = this.#gltfMaterialTextureRef(loadedMaterial);
      if (loadedMaterial.image !== undefined && baseColor !== undefined) {
        this.#ensureImmediateTexture(baseColor, loadedMaterial.image);
        material = { baseColor, kind: "standard" };
      }
      const baseGeometryKey = `${state.key}:primitive:${primitive.key}`;
      const generatedLod = this.#selectedGeneratedGltfPrimitiveLod(
        autoLodPolicy,
        state,
        renderInstanceKey,
        primitive,
        model,
        projection,
        view,
      );
      const cpu: CpuGeometry = {
        indices: generatedLod?.indices ?? primitive.indices,
        key: generatedLod === undefined ? baseGeometryKey : `${baseGeometryKey}:generated-lod:${generatedLod.level}`,
        mode: "triangles",
        ...(primitive.normals === undefined ? {} : { normals: primitive.normals }),
        positions: primitive.positions,
        ...(primitive.texCoords === undefined ? {} : { texCoords: primitive.texCoords }),
        ...(generatedLod === undefined ? {} : { vertexBufferKey: baseGeometryKey }),
      };
      if (!this.#isVisible(cpu.positions, model, projection, view)) {
        continue;
      }
      const gpu = this.#geometryResource(cpu);
      if (generatedLod !== undefined) usedGeometry.add(baseGeometryKey);
      usedGeometry.add(gpu.key);
      this.#drawGeometry(gpu, material, model, projection, view, light);
    }
  }

  #selectedGeneratedGltfPrimitiveLod(
    autoLodPolicy: AutoLodPolicy | undefined,
    state: GltfState,
    renderInstanceKey: string,
    primitive: LoadedGltfPrimitive,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
  ): GeneratedGltfPrimitiveLodLevel | undefined {
    if (autoLodPolicy?.generatedMeshes !== "experimental") return undefined;
    const lod = primitive.generatedLod;
    if (lod === undefined) return undefined;
    if (lod.status === "unsupported") {
      if (lod.diagnostic !== undefined && !lod.diagnosticRecorded) {
        lod.diagnosticRecorded = true;
        this.#recordDiagnostic(lod.diagnostic);
      }
      return undefined;
    }
    if (lod.status === "pending") this.#scheduleGeneratedGltfPrimitiveLod(state, primitive);

    const coverage = projectedScreenCoverage(primitive.positions, model, projection, view);
    const level = this.#selectGltfLodLevel(
      `${state.key}:${renderInstanceKey}:generated:${primitive.key}`,
      coverage,
      GENERATED_GLTF_LOD_THRESHOLDS.length,
      GENERATED_GLTF_LOD_THRESHOLDS,
      (candidate) => candidate === 0 || (
        lod.status === "ready"
        && lod.levels.some((generatedLevel) => generatedLevel.level === candidate)
      ),
      (candidate) => candidate === 0 || lod.levels.some((generatedLevel) => generatedLevel.level === candidate),
    );

    return level === 0
      ? undefined
      : lod.levels.find((generatedLevel) => generatedLevel.level === level);
  }

  #scheduleGeneratedGltfPrimitiveLod(state: GltfState, primitive: LoadedGltfPrimitive): void {
    const lod = primitive.generatedLod;
    if (lod === undefined || lod.status !== "pending" || lod.scheduled) return;
    lod.scheduled = true;
    const run = (): void => {
      if (this.#disposed || state.status !== "ready" || lod.status !== "pending") return;
      lod.levels = generatedGltfIndexLodLevels(primitive.indices);
      lod.status = "ready";
      this.#recordDiagnostic(
        `experimental generated glTF LOD ready for ${state.key}:primitive:${primitive.key}; `
        + "using deterministic triangle-stride index reduction",
      );
      this.#scheduleRender();
    };
    const queue = globalThis.queueMicrotask;
    if (typeof queue === "function") {
      queue(run);
    } else {
      globalThis.setTimeout(run, 0);
    }
  }

  #selectedGltfNodeLodLevels(
    state: GltfState,
    renderInstanceKey: string,
    rootModel: Mat4,
    projection: Mat4,
    view: Mat4,
  ): Map<string, number> {
    const coverages = new Map<string, number>();
    const lods = new Map<string, GltfNodePrimitiveLod>();
    const levelPrimitives = new Map<string, LoadedGltfPrimitive[]>();

    for (const primitive of state.primitives) {
      const lod = primitive.nodeLod;
      if (lod === undefined) continue;
      lods.set(lod.group, lod);
      const levelKey = `${lod.group}:${lod.level}`;
      levelPrimitives.set(levelKey, [...(levelPrimitives.get(levelKey) ?? []), primitive]);
      if (lod.level !== 0) continue;

      const model = multiplyMat4(rootModel, primitive.model);
      const coverage = projectedScreenCoverage(primitive.positions, model, projection, view);
      coverages.set(lod.group, Math.max(coverages.get(lod.group) ?? 0, coverage));
    }

    const selected = new Map<string, number>();
    for (const [group, lod] of lods) {
      const selectionKey = `${state.key}:${renderInstanceKey}:node:${group}`;
      const level = this.#selectGltfLodLevel(
        selectionKey,
        coverages.get(group) ?? 0,
        lod.levelCount,
        lod.thresholds,
        (level) => {
          const primitives = levelPrimitives.get(`${group}:${level}`) ?? [];
          return primitives.length > 0
            && primitives.every((primitive) => this.#isGltfPrimitiveReadyForLod(primitive));
        },
        (level) => (levelPrimitives.get(`${group}:${level}`) ?? []).length > 0,
      );
      selected.set(group, level);
    }

    return selected;
  }

  #selectedGltfMaterial(
    state: GltfState,
    renderInstanceKey: string,
    primitive: LoadedGltfPrimitive,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
  ): { readonly level: number; readonly material: LoadedGltfMaterial } {
    const lod = primitive.materialLod;
    if (lod === undefined) return { level: 0, material: primitive.material };

    const coverage = projectedScreenCoverage(primitive.positions, model, projection, view);
    const level = this.#selectGltfLodLevel(
      `${state.key}:${renderInstanceKey}:material:${primitive.key}`,
      coverage,
      lod.levels.length,
      lod.thresholds,
      (level) => {
        const material = lod.levels[level];
        return material !== undefined && this.#isGltfMaterialReadyForLod(material);
      },
      (level) => lod.levels[level] !== undefined,
    );
    return { level, material: lod.levels[level] ?? primitive.material };
  }

  #selectGltfLodLevel(
    selectionKey: string,
    coverage: number,
    levelCount: number,
    thresholds: readonly number[],
    isReady: (level: number) => boolean,
    isDrawable: (level: number) => boolean,
  ): number {
    const previous = this.#gltfLodSelections.get(selectionKey)?.level;
    const target = hystereticLodLevel(coverage, levelCount, thresholds, previous);
    const selected = this.#drawableGltfLodLevel(target, previous, levelCount, isReady, isDrawable);
    this.#activeGltfLodSelectionKeys.add(selectionKey);
    this.#gltfLodSelections.set(selectionKey, {
      level: selected,
    });
    return selected;
  }

  #drawableGltfLodLevel(
    target: number,
    previous: number | undefined,
    levelCount: number,
    isReady: (level: number) => boolean,
    isDrawable: (level: number) => boolean,
  ): number {
    if (isReady(target)) return target;
    if (previous !== undefined && previous >= 0 && previous < levelCount && isDrawable(previous)) {
      return previous;
    }
    for (let level = 0; level < levelCount; level += 1) {
      if (isReady(level)) return level;
    }
    if (isDrawable(target)) return target;
    for (let level = 0; level < levelCount; level += 1) {
      if (isDrawable(level)) return level;
    }
    return target;
  }

  #pruneGltfLodSelections(): void {
    for (const key of this.#gltfLodSelections.keys()) {
      if (!this.#activeGltfLodSelectionKeys.has(key)) this.#gltfLodSelections.delete(key);
    }
  }

  #isGltfPrimitiveReadyForLod(primitive: LoadedGltfPrimitive): boolean {
    const materials = primitive.materialLod?.levels ?? [primitive.material];
    return materials.some((material) => this.#isGltfMaterialReadyForLod(material));
  }

  #isGltfMaterialReadyForLod(material: LoadedGltfMaterial): boolean {
    if (material.baseColorTextureUri === undefined) return true;
    if (material.image !== undefined) return true;
    const texture = this.#gltfMaterialTextureRef(material);
    if (texture === undefined) return true;
    return this.#textures.get(textureKey(texture))?.uploaded === true;
  }

  #gltfMaterialTextureRef(material: LoadedGltfMaterial): TextureAssetUploadRef | undefined {
    if (material.baseColorTextureUri === undefined) return undefined;
    return {
      colorSpace: "srgb",
      flipY: false,
      kind: "asset",
      ...(material.sampler === undefined ? {} : { sampler: material.sampler }),
      uri: material.baseColorTextureUri,
    };
  }

  #preloadAdjacentGltfNodeLodTextures(
    primitives: readonly LoadedGltfPrimitive[],
    selectedLevels: ReadonlyMap<string, number>,
  ): void {
    for (const [group, level] of selectedLevels) {
      const lod = primitives.find((primitive) => primitive.nodeLod?.group === group)?.nodeLod;
      if (lod === undefined) continue;
      for (const adjacentLevel of adjacentLodLevels(level, lod.levelCount)) {
        for (const primitive of primitives) {
          if (primitive.nodeLod?.group === group && primitive.nodeLod.level === adjacentLevel) {
            this.#preloadGltfPrimitiveTextures(primitive);
          }
        }
      }
    }
  }

  #preloadAdjacentGltfMaterialLodTextures(
    lod: GltfMaterialPrimitiveLod | undefined,
    selectedLevel: number,
  ): void {
    if (lod === undefined) return;
    for (const level of adjacentLodLevels(selectedLevel, lod.levels.length)) {
      const material = lod.levels[level];
      if (material !== undefined) this.#preloadGltfMaterialTexture(material);
    }
  }

  #preloadGltfPrimitiveTextures(primitive: LoadedGltfPrimitive): void {
    this.#preloadGltfMaterialTexture(primitive.material);
    for (const material of primitive.materialLod?.levels ?? []) {
      this.#preloadGltfMaterialTexture(material);
    }
  }

  #preloadGltfMaterialTexture(material: LoadedGltfMaterial): void {
    const texture = this.#gltfMaterialTextureRef(material);
    if (texture === undefined || material.image === undefined) return;
    this.#ensureImmediateTexture(texture, material.image);
  }

  #drawGeometry(
    geometry: GeometryResource,
    material: Material,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
  ): void {
    const gl = this.#gl;
    const programResource = this.#program(material.kind === "wireframe" ? "wireframe" : "surface");
    const program = programResource.program;
    gl.useProgram(program);

    this.#uniformMatrix(program, "u_projection", projection);
    this.#uniformMatrix(program, "u_view", view);
    this.#uniformMatrix(program, "u_model", model);
    this.#uniformColor(program, "u_color", materialColor(material));
    this.#uniform1i(program, "u_unlit", material.kind === "standard" ? 0 : 1);
    if (material.kind === "standard") {
      this.#uniformColor(program, "u_lightColor", light?.color ?? DEFAULT_LIGHT_COLOR);
      this.#uniformVec3(program, "u_lightDirection", light?.direction ?? DEFAULT_LIGHT_DIRECTION);
    } else if (material.kind !== "wireframe") {
      this.#uniformColor(program, "u_lightColor", DEFAULT_LIGHT_COLOR);
    }

    this.#uniform1i(program, "u_useTexture", this.#bindMaterialTexture(program, material) ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.arrayBuffer);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    }
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    if (uvLocation >= 0) {
      if (geometry.texCoordBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.texCoordBuffer);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray?.(uvLocation);
      }
    }
    const normalLocation = gl.getAttribLocation(program, "a_normal");
    if (normalLocation >= 0) {
      if (geometry.normalBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
        gl.enableVertexAttribArray(normalLocation);
        gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray?.(normalLocation);
      }
    }
    if (geometry.indexBuffer !== undefined && geometry.indexType !== undefined) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
    }

    if (material.kind === "wireframe") gl.lineWidth?.(material.width);

    const mode = geometry.mode === "lines" ? gl.LINES : gl.TRIANGLES;
    if (geometry.indexBuffer === undefined || geometry.indexType === undefined) {
      gl.drawArrays(mode, 0, geometry.drawCount);
    } else {
      gl.drawElements(mode, geometry.drawCount, geometry.indexType, 0);
    }
  }

  #bindMaterialTexture(program: WebGLProgram, material: Material): boolean {
    if (material.baseColor.kind === "solid") return false;
    let resource: TextureResource | TextureLoadState;
    if (material.baseColor.kind === "virtual-asset") {
      if (material.baseColor.preview === undefined) {
        resource = this.#virtualTexture(material.baseColor);
      } else {
        const preview = this.#texture(material.baseColor.preview);
        const previewError = "error" in preview && preview.error !== undefined;
        resource = preview.uploaded || !previewError
          ? preview
          : this.#virtualTexture(material.baseColor);
      }
    } else {
      resource = this.#texture(material.baseColor);
    }
    if (!resource.uploaded) return false;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    const location = gl.getUniformLocation(program, "u_texture");
    if (location !== null) gl.uniform1i(location, 0);
    return true;
  }

  #uniformMatrix(program: WebGLProgram, name: string, matrix: Mat4): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
  }

  #uniformColor(program: WebGLProgram, name: string, color: Rgba): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform4fv(location, new Float32Array(color));
  }

  #uniformVec3(program: WebGLProgram, name: string, vector: Vec3): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location === null) return;
    if (typeof this.#gl.uniform3fv === "function") {
      this.#gl.uniform3fv(location, new Float32Array(vector));
    } else {
      this.#gl.uniform3f(location, vector[0], vector[1], vector[2]);
    }
  }

  #uniform1i(program: WebGLProgram, name: string, value: number): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform1i(location, value);
  }

  #program(kind: ProgramKind): ProgramResource {
    const cached = this.#programs.get(kind);
    if (cached !== undefined) return cached;

    const program = this.#compileProgram(kind);
    this.#programs.set(kind, program);
    return program;
  }

  #compileProgram(kind: ProgramKind): ProgramResource {
    const gl = this.#gl;
    const program = gl.createProgram();
    if (program === null) throw new Error("WebGL program creation failed");
    this.#ownedPrograms.add(program);

    let vertexShader: WebGLShader | undefined;
    let fragmentShader: WebGLShader | undefined;

    try {
      vertexShader = this.#compileShader(gl.VERTEX_SHADER, this.#vertexShaderSource(kind));
      fragmentShader = this.#compileShader(gl.FRAGMENT_SHADER, this.#fragmentShaderSource(kind));
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation?.(program, 0, "a_position");
      gl.bindAttribLocation?.(program, 1, "a_normal");
      gl.bindAttribLocation?.(program, 2, "a_uv");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program) ?? "unknown link error"}`);
      }

      return { fragmentShader, program, vertexShader };
    } catch (error) {
      if (vertexShader !== undefined) this.#deleteShader(vertexShader);
      if (fragmentShader !== undefined) this.#deleteShader(fragmentShader);
      this.#deleteProgram(program);
      throw error;
    }
  }

  #compileShader(type: number, source: string): WebGLShader {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    if (shader === null) throw new Error("WebGL shader creation failed");
    this.#ownedShaders.add(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? "unknown compile error";
      this.#deleteShader(shader);
      throw new Error(`WebGL shader compile failed: ${info}`);
    }

    return shader;
  }

  #vertexShaderSource(kind: ProgramKind): string {
    if (kind === "wireframe") {
      return `#version 300 es
in vec3 a_position;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`;
    }

    return `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec3 v_normal;
out vec2 v_uv;
void main() {
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`;
  }

  #fragmentShaderSource(kind: ProgramKind): string {
    if (kind === "wireframe") {
      return `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}`;
    }

    return `#version 300 es
precision mediump float;
in vec3 v_normal;
in vec2 v_uv;
uniform bool u_useTexture;
uniform bool u_unlit;
uniform vec4 u_color;
uniform vec4 u_lightColor;
uniform vec3 u_lightDirection;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
  vec4 baseColor = u_useTexture ? texture(u_texture, v_uv) : u_color;
  if (u_unlit) {
    outColor = baseColor;
    return;
  }
  float lambert = max(dot(normalize(v_normal), normalize(-u_lightDirection)), 0.0);
  vec3 lit = baseColor.rgb * (0.18 + lambert * u_lightColor.rgb);
  outColor = vec4(lit, baseColor.a);
}`;
  }

  #meshGeometry(geometry: MeshNode["geometry"], material: Material): CpuGeometry {
    if (material.kind === "wireframe") return this.#wireGeometry(geometry);

    switch (geometry.kind) {
      case "box":
        return this.#boxGeometry(geometry as BoxGeometry);
      case "plane":
        return this.#planeGeometry(geometry as PlaneGeometry);
      default:
        throw new Error(`Unsupported geometry kind "${geometry.kind}"`);
    }
  }

  #wireGeometry(geometry: MeshNode["geometry"]): CpuGeometry {
    if (geometry.kind === "plane") {
      const plane = geometry as PlaneGeometry;
      const [width, height] = plane.size;
      const x = width / 2;
      const y = height / 2;
      return {
        indices: new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]),
        key: `wire:plane:${width},${height}`,
        mode: "lines",
        positions: new Float32Array([
          -x, -y, 0,
          x, -y, 0,
          x, y, 0,
          -x, y, 0,
        ]),
        texCoords: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
      };
    }
    if (geometry.kind === "box") {
      const box = geometry as BoxGeometry;
      const [width, height, depth] = box.size;
      const x = width / 2;
      const y = height / 2;
      const z = depth / 2;
      return {
        indices: new Uint16Array([
          0, 1, 1, 2, 2, 3, 3, 0,
          4, 5, 5, 6, 6, 7, 7, 4,
          0, 4, 1, 5, 2, 6, 3, 7,
        ]),
        key: `wire:box:${width},${height},${depth}`,
        mode: "lines",
        positions: new Float32Array([
          -x, -y, z,
          x, -y, z,
          x, y, z,
          -x, y, z,
          -x, -y, -z,
          x, -y, -z,
          x, y, -z,
          -x, y, -z,
        ]),
      };
    }

    throw new Error(`Unsupported geometry kind "${geometry.kind}"`);
  }

  #planeGeometry(geometry: PlaneGeometry): CpuGeometry {
    const [width, height] = geometry.size;
    const x = width / 2;
    const y = height / 2;
    return {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        key: `plane:${width},${height}`,
        mode: "triangles",
        normals: new Float32Array([
          0, 0, 1,
          0, 0, 1,
          0, 0, 1,
          0, 0, 1,
        ]),
        positions: new Float32Array([
          -x, -y, 0,
          x, -y, 0,
          x, y, 0,
          -x, y, 0,
        ]),
        texCoords: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
      };
  }

  #boxGeometry(geometry: BoxGeometry): CpuGeometry {
    const [width, height, depth] = geometry.size;
    const x = width / 2;
    const y = height / 2;
    const z = depth / 2;
    return {
      indices: new Uint16Array([
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23,
      ]),
      key: `box:${width},${height},${depth}`,
      mode: "triangles",
      normals: new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        0, 0, -1,
        -1, 0, 0,
        -1, 0, 0,
        -1, 0, 0,
        -1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, -1, 0,
        0, -1, 0,
        0, -1, 0,
        0, -1, 0,
      ]),
      positions: new Float32Array([
        -x, -y, z,
        x, -y, z,
        x, y, z,
        -x, y, z,
        x, -y, -z,
        -x, -y, -z,
        -x, y, -z,
        x, y, -z,
        -x, -y, -z,
        -x, -y, z,
        -x, y, z,
        -x, y, -z,
        x, -y, z,
        x, -y, -z,
        x, y, -z,
        x, y, z,
        -x, y, z,
        x, y, z,
        x, y, -z,
        -x, y, -z,
        -x, -y, -z,
        x, -y, -z,
        x, -y, z,
        -x, -y, z,
      ]),
      texCoords: new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]),
    };
  }

  #isVisible(
    positions: Float32Array,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
  ): boolean {
    if (positions.length === 0) return false;

    const mvp = multiplyMat4(projection, multiplyMat4(view, model));
    const outside = [true, true, true, true, true, true];
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]!;
      const y = positions[index + 1]!;
      const z = positions[index + 2]!;
      const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      const clipZ = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14];
      const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      outside[0] &&= clipX < -clipW;
      outside[1] &&= clipX > clipW;
      outside[2] &&= clipY < -clipW;
      outside[3] &&= clipY > clipW;
      outside[4] &&= clipZ < -clipW;
      outside[5] &&= clipZ > clipW;
    }

    return !outside.some(Boolean);
  }

  #geometryResource(cpu: CpuGeometry): GeometryResource {
    const cached = this.#geometry.get(cpu.key);
    if (cached !== undefined) return cached;

    const gl = this.#gl;
    const borrowedVertexResource = cpu.vertexBufferKey === undefined
      ? undefined
      : this.#geometry.get(cpu.vertexBufferKey);
    const arrayBuffer = borrowedVertexResource?.arrayBuffer ?? this.#createBuffer();
    if (borrowedVertexResource === undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, arrayBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.positions, gl.STATIC_DRAW);
    }

    let normalBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      normalBuffer = borrowedVertexResource.normalBuffer;
    } else if (cpu.normals !== undefined) {
      normalBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.normals, gl.STATIC_DRAW);
    }

    let texCoordBuffer: WebGLBuffer | undefined;
    if (borrowedVertexResource !== undefined) {
      texCoordBuffer = borrowedVertexResource.texCoordBuffer;
    } else if (cpu.texCoords !== undefined) {
      texCoordBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.texCoords, gl.STATIC_DRAW);
    }

    let indexBuffer: WebGLBuffer | undefined;
    let indexType: number | undefined;
    if (cpu.indices !== undefined) {
      indexBuffer = this.#createBuffer();
      indexType = cpu.indices instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : cpu.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cpu.indices, gl.STATIC_DRAW);
    }

    const resource: GeometryResource = {
      arrayBuffer,
      ...(borrowedVertexResource === undefined ? {} : { borrowedVertexBufferKey: borrowedVertexResource.key }),
      drawCount: cpu.indices?.length ?? cpu.positions.length / 3,
      ...(indexBuffer === undefined ? {} : { indexBuffer }),
      ...(indexType === undefined ? {} : { indexType }),
      key: cpu.key,
      mode: cpu.mode,
      ...(normalBuffer === undefined ? {} : { normalBuffer }),
      ...(texCoordBuffer === undefined ? {} : { texCoordBuffer }),
    };
    this.#geometry.set(cpu.key, resource);
    return resource;
  }

  #releaseUnusedGeometry(used: Set<string>): void {
    for (const [key, resource] of this.#geometry) {
      if (used.has(key)) continue;
      if (resource.borrowedVertexBufferKey === undefined) {
        this.#deleteBuffer(resource.arrayBuffer);
        if (resource.normalBuffer !== undefined) this.#deleteBuffer(resource.normalBuffer);
        if (resource.texCoordBuffer !== undefined) this.#deleteBuffer(resource.texCoordBuffer);
      }
      if (resource.indexBuffer !== undefined) this.#deleteBuffer(resource.indexBuffer);
      this.#geometry.delete(key);
    }
  }

  #texture(texture: TextureAssetUploadRef): TextureResource | TextureLoadState {
    const key = textureKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined) return cached;

    const glTexture = this.#createTexture();
    const state: TextureLoadState = {
      key,
      loading: true,
      texture: glTexture,
      uploaded: false,
    };
    this.#textures.set(key, state);

    loadImage(texture.uri).then((image) => {
      if (this.#disposed) return;
      state.loading = false;
      this.#uploadTexture(state, image, texture);
      this.#scheduleRender();
    }, (error: unknown) => {
      if (this.#disposed) return;
      state.loading = false;
      state.error = `Texture image load failed for ${texture.uri}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    });

    return state;
  }

  #virtualTexture(texture: Extract<TextureRef, { readonly kind: "virtual-asset" }>): TextureResource | TextureLoadState {
    const key = textureKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined) return cached;

    const glTexture = this.#createTexture();
    const state: TextureLoadState = {
      key,
      loading: true,
      texture: glTexture,
      uploaded: false,
    };
    this.#textures.set(key, state);

    this.#loadVirtualTexturePage(texture).then((image) => {
      if (this.#disposed) return;
      state.loading = false;
      const uploadTexture: TextureAssetUploadRef = {
        kind: "asset",
        uri: texture.manifestUri,
        ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
        ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
        ...(texture.version === undefined ? {} : { version: texture.version }),
      };
      this.#uploadTexture(state, image, uploadTexture);
      this.#scheduleRender();
    }, (error: unknown) => {
      if (this.#disposed) return;
      state.loading = false;
      state.error = `Virtual texture load failed for ${texture.manifestUri}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    });

    return state;
  }

  async #loadVirtualTexturePage(
    texture: Extract<TextureRef, { readonly kind: "virtual-asset" }>,
  ): Promise<HTMLImageElement | ImageBitmap> {
    const response = await fetch(texture.manifestUri);
    if (!response.ok) throw new Error(`manifest ${response.status} ${response.statusText}`);
    const manifest = await response.json() as MinimalVirtualTextureManifest;
    const pageUri = firstVirtualTexturePageUri(manifest);
    if (pageUri === undefined) {
      throw new Error("manifest does not reference any page image");
    }

    return await loadFetchedImage(resolveUrl(texture.manifestUri, pageUri));
  }

  #ensureImmediateTexture(texture: TextureAssetUploadRef, image: HTMLImageElement | ImageBitmap): TextureResource {
    const key = textureKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined && cached.uploaded) return cached;

    const resource: TextureResource = cached ?? {
      key,
      texture: this.#createTexture(),
      uploaded: false,
    };
    this.#textures.set(key, resource);
    this.#uploadTexture(resource, image, texture);
    return resource;
  }

  #uploadTexture(
    resource: TextureResource,
    source: HTMLImageElement | ImageBitmap,
    texture: TextureAssetUploadRef,
  ): void {
    if (this.#disposed || !this.#ownedTextures.has(resource.texture)) return;

    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    if (typeof gl.pixelStorei === "function" && gl.UNPACK_FLIP_Y_WEBGL !== undefined) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY ?? true);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const sampler = texture.sampler;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, samplerConstant(gl, sampler?.magFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, samplerConstant(gl, sampler?.minFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, samplerConstant(gl, sampler?.wrapS, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, samplerConstant(gl, sampler?.wrapT, gl.CLAMP_TO_EDGE));
    if (usesMipmaps(sampler?.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
    resource.uploaded = true;
  }

  #gltfState(node: GltfNode): GltfState {
    const key = `gltf:${node.asset.uri}:${node.asset.version ?? ""}`;
    const cached = this.#gltf.get(key);
    if (cached !== undefined) return cached;

    const state: GltfState = {
      key,
      primitives: [],
      status: "loading",
    };
    this.#gltf.set(key, state);

    void this.#loadGltf(node.src, state);
    return state;
  }

  async #loadGltf(src: string, state: GltfState): Promise<void> {
    try {
      const response = await fetch(src);
      if (this.#disposed) return;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const document = await response.json() as GltfDocument;
      if (this.#disposed) return;
      const buffers = await Promise.all((document.buffers ?? []).map(async (buffer) => {
        if (buffer.uri === undefined) return new ArrayBuffer(0);
        const bufferResponse = await fetch(resolveUrl(src, buffer.uri));
        if (!bufferResponse.ok) throw new Error(`${bufferResponse.status} ${bufferResponse.statusText}`);
        return bufferResponse.arrayBuffer();
      }));
      if (this.#disposed) return;
      state.primitives = this.#readGltfPrimitives(document, buffers, src, state.key);
      state.status = "ready";
      this.#scheduleRender();
      this.#loadGltfImages(src, document, state);
    } catch (error) {
      if (this.#disposed) return;
      state.status = "error";
      state.error = `glTF load failed for ${src}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    }
  }

  #readGltfPrimitives(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    src: string,
    assetKey: string,
  ): readonly LoadedGltfPrimitive[] {
    const primitives: LoadedGltfPrimitive[] = [];
    const scene = document.scenes?.[document.scene ?? 0];
    const referencedLodNodes = new Set<number>();
    for (const node of document.nodes ?? []) {
      for (const id of node.extensions?.MSFT_lod?.ids ?? []) {
        if (Number.isInteger(id) && id >= 0) referencedLodNodes.add(id);
      }
    }

    for (const nodeIndex of scene?.nodes ?? []) {
      if (referencedLodNodes.has(nodeIndex)) continue;
      const node = document.nodes?.[nodeIndex];
      const lodIds = (node?.extensions?.MSFT_lod?.ids ?? [])
        .filter((id) => Number.isInteger(id) && id >= 0 && document.nodes?.[id] !== undefined);
      if (lodIds.length === 0) {
        this.#appendGltfNodePrimitives(document, buffers, src, assetKey, primitives, nodeIndex);
        continue;
      }

      const levelCount = lodIds.length + 1;
      const thresholds = gltfLodThresholds(node?.extras, levelCount);
      const group = `node:${nodeIndex}`;
      this.#appendGltfNodePrimitives(document, buffers, src, assetKey, primitives, nodeIndex, {
        group,
        level: 0,
        levelCount,
        thresholds,
      });
      for (const [lodIndex, lodNodeIndex] of lodIds.entries()) {
        this.#appendGltfNodePrimitives(document, buffers, src, assetKey, primitives, lodNodeIndex, {
          group,
          level: lodIndex + 1,
          levelCount,
          thresholds,
        });
      }
    }

    return primitives;
  }

  #appendGltfNodePrimitives(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    src: string,
    assetKey: string,
    primitives: LoadedGltfPrimitive[],
    nodeIndex: number,
    nodeLod?: GltfNodePrimitiveLod,
  ): void {
    const sceneNode = document.nodes?.[nodeIndex];
    const nodeModel = gltfNodeMat4(sceneNode);
    const mesh = sceneNode?.mesh === undefined ? undefined : document.meshes?.[sceneNode.mesh];
    for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
      const positionAccessor = primitive.attributes?.POSITION;
      const normalAccessor = primitive.attributes?.NORMAL;
      const texCoordAccessor = primitive.attributes?.TEXCOORD_0;
      const indexAccessor = primitive.indices;
      if (positionAccessor === undefined || indexAccessor === undefined) continue;
      const material = this.#readGltfMaterial(document, src, assetKey, primitive.material);
      const materialLod = this.#readGltfMaterialLod(document, src, assetKey, primitive.material);
      const key = `node:${nodeIndex}:primitive:${primitiveIndex}`;
      const generatedLod = this.#prepareGeneratedGltfPrimitiveLod(
        document,
        sceneNode,
        mesh,
        primitive,
        key,
      );
      primitives.push({
        ...(generatedLod === undefined ? {} : { generatedLod }),
        indices: this.#readGltfIndices(document, buffers, indexAccessor),
        key,
        material,
        ...(materialLod === undefined ? {} : { materialLod }),
        model: nodeModel,
        ...(nodeLod === undefined ? {} : { nodeLod }),
        ...(normalAccessor === undefined ? {} : { normals: this.#readGltfNormals(document, buffers, normalAccessor) }),
        positions: this.#readGltfPositions(document, buffers, positionAccessor),
        ...(texCoordAccessor === undefined ? {} : { texCoords: this.#readGltfTexCoords(document, buffers, texCoordAccessor) }),
      });
    }
  }

  #prepareGeneratedGltfPrimitiveLod(
    document: GltfDocument,
    sceneNode: GltfSceneNode | undefined,
    mesh: GltfMesh | undefined,
    primitive: GltfMeshPrimitive,
    primitiveKey: string,
  ): GeneratedGltfPrimitiveLod | undefined {
    const unsupported = this.#generatedGltfPrimitiveUnsupportedReason(document, sceneNode, mesh, primitive);
    if (unsupported !== undefined) {
      const diagnostic = `experimental generated glTF LOD skipped for ${primitiveKey}: ${unsupported}`;

      return {
        diagnostic,
        diagnosticRecorded: false,
        levels: [],
        scheduled: false,
        status: "unsupported",
      };
    }

    return {
      diagnosticRecorded: false,
      levels: [],
      scheduled: false,
      status: "pending",
    };
  }

  #generatedGltfPrimitiveUnsupportedReason(
    document: GltfDocument,
    sceneNode: GltfSceneNode | undefined,
    mesh: GltfMesh | undefined,
    primitive: GltfMeshPrimitive,
  ): string | undefined {
    if (primitive.mode !== undefined && primitive.mode !== 4) return "primitive mode is not TRIANGLES";
    if (sceneNode?.skin !== undefined) return "skinning is not supported";
    if ((primitive.targets?.length ?? 0) > 0 || (mesh?.weights?.length ?? 0) > 0) return "morph targets are not supported";

    const attributes = primitive.attributes ?? {};
    for (const semantic of Object.keys(attributes)) {
      if (semantic !== "POSITION" && semantic !== "NORMAL" && semantic !== "TEXCOORD_0") {
        return `custom attribute ${semantic} is not supported`;
      }
    }

    const positionAccessor = primitive.attributes?.POSITION;
    const indexAccessor = primitive.indices;
    if (positionAccessor === undefined) return "POSITION is required";
    if (indexAccessor === undefined) return "indices are required";

    const positionReason = this.#unsupportedGeneratedGltfAccessorReason(
      document,
      positionAccessor,
      "POSITION",
      "VEC3",
      [5126],
    );
    if (positionReason !== undefined) return positionReason;

    const indexReason = this.#unsupportedGeneratedGltfAccessorReason(
      document,
      indexAccessor,
      "indices",
      "SCALAR",
      [5121, 5123, 5125],
    );
    if (indexReason !== undefined) return indexReason;

    const normalAccessor = primitive.attributes?.NORMAL;
    if (normalAccessor !== undefined) {
      const normalReason = this.#unsupportedGeneratedGltfAccessorReason(
        document,
        normalAccessor,
        "NORMAL",
        "VEC3",
        [5126],
      );
      if (normalReason !== undefined) return normalReason;
    }

    const texCoordAccessor = primitive.attributes?.TEXCOORD_0;
    if (texCoordAccessor !== undefined) {
      const texCoordReason = this.#unsupportedGeneratedGltfAccessorReason(
        document,
        texCoordAccessor,
        "TEXCOORD_0",
        "VEC2",
        [5126],
      );
      if (texCoordReason !== undefined) return texCoordReason;
    }

    const index = document.accessors?.[indexAccessor];
    if (index === undefined || index.count < 3 || index.count % 3 !== 0) {
      return "index accessor must contain complete triangles";
    }

    return undefined;
  }

  #unsupportedGeneratedGltfAccessorReason(
    document: GltfDocument,
    accessorIndex: number,
    label: string,
    type: GltfAccessor["type"],
    componentTypes: readonly number[],
  ): string | undefined {
    const accessor = document.accessors?.[accessorIndex];
    if (accessor === undefined || accessor.bufferView === undefined) return `${label} accessor is missing`;
    if (accessor.type !== type) return `${label} accessor must be ${type}`;
    if (!componentTypes.includes(accessor.componentType)) return `${label} component type is not supported`;
    if (accessor.sparse !== undefined) return `${label} sparse accessor is not supported`;

    const view = document.bufferViews?.[accessor.bufferView];
    if (view === undefined) return `${label} bufferView is missing`;
    if (view.byteStride !== undefined) return `${label} interleaved byteStride is not supported`;

    return undefined;
  }

  #readGltfMaterial(
    document: GltfDocument,
    src: string,
    assetKey: string,
    materialIndex: number | undefined,
  ): LoadedGltfMaterial {
    const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const texture = textureIndex === undefined ? undefined : document.textures?.[textureIndex];
    const imageIndex = texture?.source;
    const image = imageIndex === undefined ? undefined : document.images?.[imageIndex];
    const imageUri = image?.uri;
    const resolvedImageUri = imageUri === undefined ? undefined : resolveUrl(src, imageUri);
    const sampler = texture === undefined
      ? undefined
      : gltfTextureSampler(texture.sampler === undefined ? undefined : document.samplers?.[texture.sampler]);
    const color = gltfColor(material?.pbrMetallicRoughness?.baseColorFactor);

    return {
      ...(resolvedImageUri === undefined ? {} : { baseColorImageUri: resolvedImageUri }),
      ...(textureIndex === undefined || image === undefined
        ? {}
        : {
          baseColorTextureUri: gltfTextureIdentity(
            assetKey,
            src,
            textureIndex,
            imageIndex,
            image,
          ),
        }),
      ...(color === undefined ? {} : { color }),
      ...(sampler === undefined ? {} : { sampler }),
    };
  }

  #readGltfMaterialLod(
    document: GltfDocument,
    src: string,
    assetKey: string,
    materialIndex: number | undefined,
  ): GltfMaterialPrimitiveLod | undefined {
    const material = materialIndex === undefined ? undefined : document.materials?.[materialIndex];
    const lodIds = (material?.extensions?.MSFT_lod?.ids ?? [])
      .filter((id) => Number.isInteger(id) && id >= 0 && document.materials?.[id] !== undefined);
    if (materialIndex === undefined || lodIds.length === 0) return undefined;

    const levels = [
      this.#readGltfMaterial(document, src, assetKey, materialIndex),
      ...lodIds.map((id) => this.#readGltfMaterial(document, src, assetKey, id)),
    ];

    return {
      levels,
      thresholds: gltfLodThresholds(material?.extras, levels.length),
    };
  }

  #loadGltfImages(src: string, document: GltfDocument, state: GltfState): void {
    for (const image of document.images ?? []) {
      if (image.uri === undefined) continue;
      const uri = resolveUrl(src, image.uri);
      loadImage(uri).then((loadedImage) => {
        if (this.#disposed || state.status !== "ready") return;
        state.primitives = state.primitives.map((primitive) => ({
          ...primitive,
          material: this.#settleGltfMaterialImage(primitive.material, uri, loadedImage),
          ...(primitive.materialLod === undefined
            ? {}
            : {
              materialLod: {
                ...primitive.materialLod,
                levels: primitive.materialLod.levels.map((material) =>
                  this.#settleGltfMaterialImage(material, uri, loadedImage)),
              },
            }),
        }));
        this.#scheduleRender();
      }, (error: unknown) => {
        if (this.#disposed) return;
        if (state.status === "ready") {
          state.primitives = state.primitives.map((primitive) => ({
            ...primitive,
            material: this.#failGltfMaterialImage(primitive.material, uri),
            ...(primitive.materialLod === undefined
              ? {}
              : {
                materialLod: {
                  ...primitive.materialLod,
                  levels: primitive.materialLod.levels.map((material) =>
                    this.#failGltfMaterialImage(material, uri)),
                },
              }),
          }));
          this.#scheduleRender();
        }
        this.#recordDiagnostic(`glTF base-color image load failed for ${uri}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  #settleGltfMaterialImage(
    material: LoadedGltfMaterial,
    uri: string,
    image: HTMLImageElement | ImageBitmap,
  ): LoadedGltfMaterial {
    return material.baseColorImageUri === uri ? { ...material, image } : material;
  }

  #failGltfMaterialImage(
    material: LoadedGltfMaterial,
    uri: string,
  ): LoadedGltfMaterial {
    return material.baseColorImageUri === uri ? { ...material, imageFailed: true } : material;
  }

  #readGltfPositions(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    return this.#readGltfFloatAccessor(document, buffers, accessorIndex);
  }

  #readGltfNormals(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    return this.#readGltfFloatAccessor(document, buffers, accessorIndex);
  }

  #readGltfTexCoords(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    return this.#readGltfFloatAccessor(document, buffers, accessorIndex);
  }

  #readGltfFloatAccessor(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    const accessor = document.accessors?.[accessorIndex];
    if (accessor === undefined || accessor.bufferView === undefined) return new Float32Array();
    const view = document.bufferViews?.[accessor.bufferView];
    if (view === undefined) return new Float32Array();
    const buffer = buffers[view.buffer ?? 0];
    if (buffer === undefined) return new Float32Array();
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const byteLength = accessor.count * componentCount(accessor.type) * Float32Array.BYTES_PER_ELEMENT;
    const bytes = new Uint8Array(buffer, offset, byteLength).slice();

    return new Float32Array(bytes.buffer, 0, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  }

  #readGltfIndices(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Uint16Array | Uint32Array | Uint8Array {
    const accessor = document.accessors?.[accessorIndex];
    if (accessor === undefined || accessor.bufferView === undefined) return new Uint16Array();
    const view = document.bufferViews?.[accessor.bufferView];
    if (view === undefined) return new Uint16Array();
    const buffer = buffers[view.buffer ?? 0];
    if (buffer === undefined) return new Uint16Array();
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (accessor.componentType === 5125) {
      const bytes = new Uint8Array(buffer, offset, accessor.count * Uint32Array.BYTES_PER_ELEMENT).slice();
      return new Uint32Array(bytes.buffer, 0, accessor.count);
    }
    if (accessor.componentType === 5121) return new Uint8Array(buffer, offset, accessor.count).slice();

    const bytes = new Uint8Array(buffer, offset, accessor.count * Uint16Array.BYTES_PER_ELEMENT).slice();
    return new Uint16Array(bytes.buffer, 0, accessor.count);
  }

  #scheduleRender(): void {
    if (this.#disposed || this.#renderScheduled || this.#latestScene === undefined) return;
    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame !== "function") {
      this.render(this.#latestScene);
      return;
    }

    this.#renderScheduled = true;
    requestFrame(() => {
      this.#renderScheduled = false;
      if (!this.#disposed && this.#latestScene !== undefined) this.render(this.#latestScene);
    });
  }

  #createBuffer(): WebGLBuffer {
    const buffer = this.#gl.createBuffer();
    if (buffer === null) throw new Error("WebGL buffer creation failed");
    this.#ownedBuffers.add(buffer);
    return buffer;
  }

  #createTexture(): WebGLTexture {
    const texture = this.#gl.createTexture();
    if (texture === null) throw new Error("WebGL texture creation failed");
    this.#ownedTextures.add(texture);
    return texture;
  }

  #deleteBuffer(buffer: WebGLBuffer): void {
    if (!this.#ownedBuffers.has(buffer)) return;
    this.#gl.deleteBuffer(buffer);
    this.#ownedBuffers.delete(buffer);
  }

  #deleteShader(shader: WebGLShader): void {
    if (!this.#ownedShaders.has(shader)) return;
    this.#gl.deleteShader(shader);
    this.#ownedShaders.delete(shader);
  }

  #deleteProgram(program: WebGLProgram): void {
    if (!this.#ownedPrograms.has(program)) return;
    this.#gl.deleteProgram(program);
    this.#ownedPrograms.delete(program);
  }

  #recordDiagnostic(message: string): void {
    this.#diagnostics = [...this.#diagnostics, message];
    console.warn(message);
  }
}

/** Creates an imperative WebGL2 renderer root. */
export const createWebGlRoot = (
  canvas: HTMLCanvasElement,
  options?: WebGlRootOptions,
): WebGlRoot => new WebGlRoot(canvas, options);
