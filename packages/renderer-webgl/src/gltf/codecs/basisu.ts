import {
  gltfBasisuTargetAcceptsBaseDimensions,
  type GltfBasisuTranscodeTarget,
} from "../../texture/compression-target";
import {
  basisuWorkerSource,
  basisuWorkerTargets,
  type BasisuDecodeTarget,
} from "./basisu-worker-source";

type BasisTextureLevel = {
  readonly compressed?: boolean;
  readonly data?: ArrayBufferView;
  readonly format?: number;
  readonly height?: number;
  readonly shape?: string;
  readonly textureFormat?: string;
  readonly width?: number;
};

export type DecodedGltfBasisuLevel = {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
};

export type DecodedGltfBasisuRgbaTexture = DecodedGltfBasisuLevel & {
  readonly kind: "rgba-texture";
  readonly levels?: readonly DecodedGltfBasisuLevel[];
};

export type DecodedGltfBasisuCompressedTexture = DecodedGltfBasisuLevel & {
  readonly format: number;
  readonly kind: "compressed-texture";
  readonly levels: readonly DecodedGltfBasisuLevel[];
  readonly srgbFormat: number;
};

export type DecodedGltfBasisuTexture =
  | DecodedGltfBasisuCompressedTexture
  | DecodedGltfBasisuRgbaTexture;

const GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC = 0x9279;
const GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT = 0x8C4F;
const GL_COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT = 0x8E8D;
const GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR = 0x93D0;
const KTX2_IDENTIFIER = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A] as const;

type Ktx2LogicalDimensions = Readonly<{ height: number; width: number }>;

const ktx2LogicalDimensions = (bytes: ArrayBuffer): Ktx2LogicalDimensions | undefined => {
  if (bytes.byteLength < 28) return undefined;
  const identifier = new Uint8Array(bytes, 0, KTX2_IDENTIFIER.length);
  for (let index = 0; index < KTX2_IDENTIFIER.length; index += 1) {
    if (identifier[index] !== KTX2_IDENTIFIER[index]) return undefined;
  }
  const header = new DataView(bytes);
  const width = header.getUint32(20, true);
  const height = header.getUint32(24, true);
  return width > 0 && height > 0 ? { height, width } : undefined;
};

const logicalBasisLevel = (
  level: BasisTextureLevel,
  base: Ktx2LogicalDimensions | undefined,
  index: number,
  label: string,
): BasisTextureLevel => {
  if (base === undefined) return level;
  const divisor = 2 ** index;
  const width = Math.max(1, Math.floor(base.width / divisor));
  const height = Math.max(1, Math.floor(base.height / divisor));
  if (level.width === width && level.height === height) return level;
  if (level.width !== Math.max(4, width) || level.height !== Math.max(4, height)) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${index} dimensions disagree with its KTX2 header`);
  }
  return { ...level, height, width };
};

const decodedLevel = (data: Uint8Array, width: number, height: number): DecodedGltfBasisuLevel => ({
  data,
  height,
  width,
});

const validLevelDimensions = (
  level: BasisTextureLevel,
  label: string,
  levelIndex: number,
): readonly [width: number, height: number] => {
  const width = level.width;
  const height = level.height;
  if (
    typeof width !== "number"
    || !Number.isInteger(width)
    || width <= 0
    || typeof height !== "number"
    || !Number.isInteger(height)
    || height <= 0
  ) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded invalid dimensions`);
  }
  return [width, height];
};

const validMipSizes = (
  levels: readonly DecodedGltfBasisuLevel[],
  label: string,
): void => {
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1]!;
    const level = levels[index]!;
    if (
      level.width !== Math.max(1, Math.floor(previous.width / 2))
      || level.height !== Math.max(1, Math.floor(previous.height / 2))
    ) throw new Error(`glTF KHR_texture_basisu ${label} has an invalid mip ${index} size`);
  }
};

const parsedBasisLevels = (parsed: unknown, label: string): readonly BasisTextureLevel[] => {
  const levels = basisTextureLevels(parsed);
  if (levels === undefined || levels.length === 0) {
    throw new Error(`glTF KHR_texture_basisu ${label} did not contain a texture level`);
  }
  return levels;
};

type CompressedBasisuTarget = Exclude<GltfBasisuTranscodeTarget, "rgba32">;
type BasisuParser = (
  bytes: ArrayBuffer,
  target: BasisuDecodeTarget,
) => Promise<unknown>;

export type BasisuParseRuntime = {
  readonly parse: BasisuParser;
  readonly supportsWorker: () => boolean;
};

type BasisuWorkerLease = Readonly<{ release(): void }>;

let basisuWorkerLeaseCount = 0;
let basisuWorkerPool: BasisuWorkerPool | undefined;

class BasisuWorkerDisposedError extends Error {}

const BASISU_WORKER_LANES = 2;
// The glTF scheduler refills decode lanes on a later task. A short grace keeps
// that sustained wave on its warm worker without retaining the burst heap once
// the scene is actually idle.
const BASISU_BURST_LANE_IDLE_MS = 100;

class BasisuWorkerPool {
  readonly #owners: BasisuWorkerOwner[] = [];
  readonly #retirements = new Map<BasisuWorkerOwner, ReturnType<typeof setTimeout>>();

  parse(bytes: ArrayBuffer, target: BasisuDecodeTarget): Promise<unknown> {
    let owner = this.#owners[0];
    if (owner === undefined) {
      owner = this.#createOwner();
      this.#owners.push(owner);
    } else {
      for (let index = 1; index < this.#owners.length; index += 1) {
        const candidate = this.#owners[index]!;
        if (candidate.queued < owner.queued) owner = candidate;
      }
      if (owner.queued > 0 && this.#owners.length < BASISU_WORKER_LANES) {
        owner = this.#createOwner();
        this.#owners.push(owner);
      }
    }
    this.#cancelRetirement(owner);
    return owner.parse(bytes, target);
  }

  dispose(): void {
    for (const timeout of this.#retirements.values()) clearTimeout(timeout);
    this.#retirements.clear();
    for (const owner of this.#owners) owner.dispose();
    this.#owners.length = 0;
  }

  #createOwner(): BasisuWorkerOwner {
    return new BasisuWorkerOwner((owner) => this.#scheduleRetirement(owner));
  }

  #cancelRetirement(owner: BasisuWorkerOwner): void {
    const timeout = this.#retirements.get(owner);
    if (timeout === undefined) return;
    clearTimeout(timeout);
    this.#retirements.delete(owner);
  }

  #scheduleRetirement(owner: BasisuWorkerOwner): void {
    const index = this.#owners.indexOf(owner);
    // Retain one warm lane. Additional lanes get a cancellable grace so a
    // scheduler refill does not repeatedly initialize the Basis WASM heap.
    if (index <= 0 || this.#retirements.has(owner)) return;
    const timeout = setTimeout(() => {
      this.#retirements.delete(owner);
      if (owner.queued !== 0) return;
      const currentIndex = this.#owners.indexOf(owner);
      if (currentIndex <= 0) return;
      this.#owners.splice(currentIndex, 1);
      owner.dispose();
    }, BASISU_BURST_LANE_IDLE_MS);
    this.#retirements.set(owner, timeout);
  }
}

class BasisuWorkerOwner {
  #disposed = false;
  #failed: unknown;
  #nextRequestId = 0;
  readonly #onIdle: (owner: BasisuWorkerOwner) => void;
  #queued = 0;
  #tail: Promise<unknown> = Promise.resolve();
  #worker: Worker | undefined;

  constructor(onIdle: (owner: BasisuWorkerOwner) => void) {
    this.#onIdle = onIdle;
  }

  static supported(): boolean {
    return typeof globalThis.Worker === "function";
  }

  get queued(): number {
    return this.#queued;
  }

  parse(bytes: ArrayBuffer, target: BasisuDecodeTarget): Promise<unknown> {
    if (this.#disposed) return Promise.reject(new BasisuWorkerDisposedError());
    this.#queued += 1;
    const parsed = this.#tail.then(() => this.#parse(bytes, target)).finally(() => {
      this.#queued -= 1;
      if (this.#queued === 0) this.#onIdle(this);
    });
    this.#tail = parsed.catch(() => undefined);
    return parsed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    void this.#tail.finally(() => { this.#terminate(); });
  }

  #parse(bytes: ArrayBuffer, target: BasisuDecodeTarget): Promise<unknown> {
    if (this.#disposed) return Promise.reject(new BasisuWorkerDisposedError());
    if (this.#failed !== undefined) return Promise.reject(this.#failed);
    this.#worker ??= createBasisuWorker();
    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.#worker!.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== "object" || data === null) return;
        const message = data as {
          error?: string;
          id?: number;
          result?: unknown;
        };
        if (message.id !== id) return;
        if (message.error === undefined) resolve(message.result);
        else reject(new Error(message.error));
      };
      this.#worker!.onerror = (event) => {
        this.#failed = event.error ?? new Error(event.message);
        this.#terminate();
        reject(this.#failed);
      };
      this.#worker!.postMessage({
        id,
        input: bytes,
        target,
      }, [bytes]);
    });
  }

  #terminate(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
  }
}

const createBasisuWorker = (): Worker => {
  const url = URL.createObjectURL(new Blob([basisuWorkerSource], { type: "application/javascript" }));
  try {
    return new Worker(url, { name: "Royal Basis" });
  } finally {
    URL.revokeObjectURL(url);
  }
};

const parseBasisuOnWorker = async (
  bytes: ArrayBuffer,
  target: BasisuDecodeTarget,
): Promise<unknown> => {
  basisuWorkerPool ??= new BasisuWorkerPool();
  return basisuWorkerPool.parse(bytes, target);
};

const basisuParseRuntime: BasisuParseRuntime = {
  parse: parseBasisuOnWorker,
  supportsWorker: () => basisuWorkerLeaseCount > 0 && BasisuWorkerOwner.supported(),
};

/** Retains the lazy, shared Basis worker until the owning renderer feature is disposed. */
export const retainGltfBasisuWorker = (): BasisuWorkerLease => {
  basisuWorkerLeaseCount += 1;
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      basisuWorkerLeaseCount -= 1;
      if (basisuWorkerLeaseCount !== 0) return;
      basisuWorkerPool?.dispose();
      basisuWorkerPool = undefined;
    },
  };
};

export const parseGltfBasisuWithRuntime = async (
  runtime: BasisuParseRuntime,
  bytes: ArrayBuffer,
  format: BasisuDecodeTarget,
): Promise<unknown> => {
  if (!runtime.supportsWorker()) throw new Error("glTF KHR_texture_basisu requires Web Worker support");
  // Recipes may share their encoded buffer, so only a disposable copy can
  // cross the worker boundary.
  return runtime.parse(bytes.slice(0), format);
};

type CompressedBasisuTargetDescriptor = Readonly<{
  format: number;
  parseFormat: Exclude<BasisuDecodeTarget, "rgba32">;
  srgbFormat: number;
  textureFormat: string;
}>;

const compressedTargetDescriptor = (
  parseFormat: CompressedBasisuTargetDescriptor["parseFormat"],
  srgbFormat: number,
): CompressedBasisuTargetDescriptor => {
  const { format, textureFormat } = basisuWorkerTargets[parseFormat];
  if (format === undefined) throw new Error(`Basis target ${parseFormat} is not compressed`);
  return { format, parseFormat, srgbFormat, textureFormat };
};

const COMPRESSED_TARGETS: Readonly<Record<CompressedBasisuTarget, CompressedBasisuTargetDescriptor>> = {
  "astc-4x4": compressedTargetDescriptor("astc-4x4", GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR),
  bc7: compressedTargetDescriptor("bc7-m5", GL_COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT),
  bc3: compressedTargetDescriptor("bc3", GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT),
  etc2: compressedTargetDescriptor("etc2", GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC),
};

const compressedLevel = (
  level: BasisTextureLevel,
  descriptor: CompressedBasisuTargetDescriptor,
  target: CompressedBasisuTarget,
  label: string,
  levelIndex: number,
): DecodedGltfBasisuLevel => {
  if (
    level.compressed !== true
    || level.format !== descriptor.format
    || level.textureFormat !== descriptor.textureFormat
  ) throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not transcode to ${target}`);
  const [width, height] = validLevelDimensions(level, label, levelIndex);
  const data = level.data;
  const expectedLength = Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  if (!(data instanceof Uint8Array) || !Number.isSafeInteger(expectedLength) || data.byteLength !== expectedLength) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded an invalid ${target} payload`);
  }
  return decodedLevel(data, width, height);
};

/** Validates and adopts a deterministic ETC2 result returned by the Basis transcoder. */
export const decodedGltfBasisuEtc2 = (
  parsed: unknown,
  label: string,
  bytes?: ArrayBuffer,
): DecodedGltfBasisuCompressedTexture => {
  const descriptor = COMPRESSED_TARGETS.etc2;
  const dimensions = bytes === undefined ? undefined : ktx2LogicalDimensions(bytes);
  const levels = parsedBasisLevels(parsed, label).map((level, index) =>
    compressedLevel(logicalBasisLevel(level, dimensions, index, label), descriptor, "etc2", label, index));
  validMipSizes(levels, label);
  const base = levels[0]!;
  return {
    data: base.data,
    format: descriptor.format,
    height: base.height,
    kind: "compressed-texture",
    levels,
    srgbFormat: descriptor.srgbFormat,
    width: base.width,
  };
};

export const decodeGltfBasisuTexture = async (
  bytes: ArrayBuffer,
  label: string,
  target: GltfBasisuTranscodeTarget = "rgba32",
): Promise<DecodedGltfBasisuTexture> => {
  if (target === "rgba32") return decodeGltfBasisuRgbaTexture(bytes, label);
  const dimensions = ktx2LogicalDimensions(bytes);
  if (
    dimensions !== undefined
    && !gltfBasisuTargetAcceptsBaseDimensions(target, dimensions.width, dimensions.height)
  ) return decodeGltfBasisuRgbaTexture(bytes, label);
  try {
    return await decodeGltfBasisuCompressedTexture(bytes, label, target);
  } catch {
    // The universally safe RGBA path below also provides the actionable error.
  }
  return decodeGltfBasisuRgbaTexture(bytes, label);
};

const decodeGltfBasisuRgbaTexture = async (
  bytes: ArrayBuffer,
  label: string,
): Promise<DecodedGltfBasisuRgbaTexture> => {
  const parsed = await parseGltfBasisuWithRuntime(basisuParseRuntime, bytes, "rgba32");
  return decodedGltfBasisuRgba(parsed, label, bytes);
};

/** Transcodes a page-addressable KTX2/Basis payload to ETC2 after explicit capability negotiation. */
export const decodeGltfBasisuEtc2Texture = async (
  bytes: ArrayBuffer,
  label: string,
): Promise<DecodedGltfBasisuCompressedTexture> => {
  return decodeGltfBasisuCompressedTexture(bytes, label, "etc2");
};

/** Transcodes KTX2/Basis into an explicitly negotiated GPU format. */
export const decodeGltfBasisuCompressedTexture = async (
  bytes: ArrayBuffer,
  label: string,
  target: CompressedBasisuTarget,
): Promise<DecodedGltfBasisuCompressedTexture> => {
  const descriptor = COMPRESSED_TARGETS[target];
  const dimensions = ktx2LogicalDimensions(bytes);
  if (
    dimensions !== undefined
    && !gltfBasisuTargetAcceptsBaseDimensions(target, dimensions.width, dimensions.height)
  ) throw new Error(`glTF KHR_texture_basisu ${label} dimensions cannot be uploaded as ${target} in WebGL`);
  const parsed = await parseGltfBasisuWithRuntime(
    basisuParseRuntime,
    bytes,
    descriptor.parseFormat,
  );
  const levels = parsedBasisLevels(parsed, label).map((level, index) => compressedLevel(
    logicalBasisLevel(level, dimensions, index, label),
    descriptor,
    target,
    label,
    index,
  ));
  validMipSizes(levels, label);
  const base = levels[0]!;
  return {
    data: base.data,
    format: descriptor.format,
    height: base.height,
    kind: "compressed-texture",
    levels,
    srgbFormat: descriptor.srgbFormat,
    width: base.width,
  };
};

/* RGBA remains the fallback when deterministic compressed transcoding is unavailable. */
const rgbaLevel = (
  level: BasisTextureLevel,
  label: string,
  levelIndex: number,
): DecodedGltfBasisuLevel => {
  if (level.compressed === true || level.textureFormat !== "rgba8unorm") {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not transcode to uncompressed RGBA8`);
  }
  const [width, height] = validLevelDimensions(level, label, levelIndex);
  const data = level.data;
  if (!(data instanceof Uint8Array)) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} did not decode to RGBA8 bytes`);
  }
  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength) || data.byteLength !== expectedLength) {
    throw new Error(`glTF KHR_texture_basisu ${label} mip ${levelIndex} decoded an invalid RGBA8 payload`);
  }
  return decodedLevel(data, width, height);
};

/** Validates and adopts the deterministic RGBA result returned by the Basis transcoder. */
export const decodedGltfBasisuRgba = (
  parsed: unknown,
  label: string,
  bytes?: ArrayBuffer,
): DecodedGltfBasisuRgbaTexture => {
  const dimensions = bytes === undefined ? undefined : ktx2LogicalDimensions(bytes);
  const levels = parsedBasisLevels(parsed, label).map((level, index) =>
    rgbaLevel(logicalBasisLevel(level, dimensions, index, label), label, index));
  validMipSizes(levels, label);
  const base = levels[0]!;
  return {
    data: base.data,
    height: base.height,
    kind: "rgba-texture",
    levels,
    width: base.width,
  };
};

const isBasisTextureLevel = (value: unknown): value is BasisTextureLevel =>
  typeof value === "object" && value !== null;

const basisTextureLevels = (value: unknown): readonly BasisTextureLevel[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const firstImage = value[0];
  if (!Array.isArray(firstImage)) return undefined;
  return firstImage.every(isBasisTextureLevel) ? firstImage : undefined;
};
