import {
  decodedTextureBytes,
  decodedTextureHasCompleteMipChain,
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./sources";
import type { TextureAssetUploadRef } from "../webgl/materials";
import {
  createOwnedTexture,
  ownsTexture,
  releaseOwnedTexture,
  type TextureHandleArena,
} from "../webgl/texture-handle-arena";
import { uploadTexture, usesMipmaps } from "../webgl/texture-upload";
import { captureFailure, type CapturedFailure } from "../captured-failure";

// The byte governor remains the authoritative frame budget. Keep a separate
// command-count ceiling so a collection of tiny images cannot monopolize a
// frame, while allowing one material's common texture set to settle together.
const MAX_UPLOADS_PER_FRAME = 4;

declare const authority: unique symbol;

export interface OrdinaryTextureGpuArena {
  readonly [authority]: "OrdinaryTextureGpuArena";
}

interface OrdinaryTextureGpuResourceBase {
  readonly generation: number;
  readonly key: string;
}

export type OrdinaryTextureGpuResource = OrdinaryTextureGpuResourceBase & (
  | { readonly texture: WebGLTexture; readonly uploaded: true }
  | { readonly texture: undefined; readonly uploaded: false }
);

export interface OrdinaryTexturePendingUpload {
  readonly source: LoadedTextureSource;
  readonly texture: TextureAssetUploadRef;
}

export interface OrdinaryTextureGpuReleaseResult {
  readonly releaseError: unknown;
  readonly releaseErrorPresent: boolean;
  /** Whether a logical GPU resource row was removed. */
  readonly released: boolean;
}

export interface OrdinaryTextureGpuLease {
  release(): void;
}

export interface OrdinaryTextureGpuReservation {
  cancel(): void;
  commit(): OrdinaryTextureGpuLease;
}

export interface OrdinaryTextureGpuAdmission {
  reserve(cost: {
    readonly persistentGpuBytes: number;
    readonly uploadBytes: number;
  }): OrdinaryTextureGpuReservation | {
    readonly reason:
      | "persistent-gpu-capacity"
      | "persistent-gpu-hard-limit"
      | "persistent-gpu-mandatory-floor"
      | "upload-capacity";
  } | {
    readonly limit: number;
    readonly reason: "persistent-gpu-cost-exceeds-limit" | "upload-cost-exceeds-limit";
  };
}

type OrdinaryTextureGpuOutcomeBase = {
  readonly key: string;
  readonly upload: OrdinaryTexturePendingUpload;
};

export type OrdinaryTextureGpuOutcome = OrdinaryTextureGpuOutcomeBase & ({
  readonly kind: "completed" | "discarded" | "retained";
} | {
  readonly kind: "failed";
  readonly message: string;
});

type MutableResource = {
  readonly generation: number;
  gpuBytes: number;
  readonly key: string;
  lease?: OrdinaryTextureGpuLease;
  pending?: Readonly<{
    cost: ReturnType<typeof ordinaryTextureUploadCost>;
    upload: OrdinaryTexturePendingUpload;
  }>;
  texture?: WebGLTexture;
  uploaded: boolean;
};

type State = {
  capacityBlocked: boolean;
  readonly gl: WebGL2RenderingContext;
  readonly handles: TextureHandleArena;
  readonly outcomes: OrdinaryTextureGpuOutcome[];
  readonly orphanedLeases: OrdinaryTextureGpuLease[];
  pendingUploadBytes: number;
  readonly pendingUploads: Array<MutableResource | undefined>;
  pendingUploadHead: number;
  quarantinedBytes: number;
  readonly resources: Map<string, MutableResource>;
  uploadFrame: number;
  uploadsThisFrame: number;
  wakeRequested: boolean;
};

const stateOf = (arena: OrdinaryTextureGpuArena): State => arena as unknown as State;
const mutableResource = (resource: OrdinaryTextureGpuResource): MutableResource =>
  resource as unknown as MutableResource;

export const createOrdinaryTextureGpuArena = (
  gl: WebGL2RenderingContext,
  handles: TextureHandleArena,
): OrdinaryTextureGpuArena => ({
  capacityBlocked: false,
  gl,
  handles,
  outcomes: [],
  orphanedLeases: [],
  pendingUploadBytes: 0,
  pendingUploadHead: 0,
  pendingUploads: [],
  quarantinedBytes: 0,
  resources: new Map(),
  uploadFrame: -1,
  uploadsThisFrame: 0,
  wakeRequested: false,
} as unknown as OrdinaryTextureGpuArena);

export const ordinaryTextureGpuResource = (
  arena: OrdinaryTextureGpuArena,
  key: string,
): OrdinaryTextureGpuResource | undefined =>
  stateOf(arena).resources.get(key) as unknown as OrdinaryTextureGpuResource | undefined;

export const ordinaryTextureGpuPendingUpload = (
  resource: OrdinaryTextureGpuResource,
): OrdinaryTexturePendingUpload | undefined => mutableResource(resource).pending?.upload;

export const ensureOrdinaryTextureGpuResource = (
  arena: OrdinaryTextureGpuArena,
  key: string,
  generation: number,
): OrdinaryTextureGpuResource => {
  const state = stateOf(arena);
  const existing = state.resources.get(key);
  if (existing !== undefined) {
    if (existing.generation !== generation) {
      throw new Error(`Ordinary texture ${key} belongs to stale context generation ${existing.generation}`);
    }
    return existing as unknown as OrdinaryTextureGpuResource;
  }
  const resource: MutableResource = {
    generation,
    gpuBytes: 0,
    key,
    uploaded: false,
  };
  state.resources.set(key, resource);
  return resource as unknown as OrdinaryTextureGpuResource;
};

const publishOutcome = (
  state: State,
  kind: Exclude<OrdinaryTextureGpuOutcome["kind"], "failed">,
  resource: MutableResource,
  upload: OrdinaryTexturePendingUpload,
): void => {
  state.outcomes.push({ key: resource.key, kind, upload });
};

const publishOversizedOutcome = (
  state: State,
  resource: MutableResource,
  upload: OrdinaryTexturePendingUpload,
  cost: number,
  limit: number,
  dimension: "persistent GPU" | "upload",
): void => {
  state.outcomes.push({
    key: resource.key,
    kind: "failed",
    message: `Ordinary texture ${resource.key} requires ${cost} ${dimension} bytes, exceeding the ${dimension === "upload" ? "per-frame " : ""}limit ${limit}`,
    upload,
  });
};

const clearQueuedResource = (state: State, resource: MutableResource): void => {
  for (let index = state.pendingUploadHead; index < state.pendingUploads.length; index += 1) {
    if (state.pendingUploads[index] === resource) state.pendingUploads[index] = undefined;
  }
};

const takePendingUpload = (
  state: State,
  resource: MutableResource,
): OrdinaryTexturePendingUpload | undefined => {
  const pending = resource.pending;
  if (pending === undefined) return undefined;
  delete resource.pending;
  state.pendingUploadBytes -= pending.cost.uploadBytes;
  return pending.upload;
};

export const discardOrdinaryTexturePendingUpload = (
  arena: OrdinaryTextureGpuArena,
  resource: OrdinaryTextureGpuResource,
): void => {
  const state = stateOf(arena);
  const mutable = mutableResource(resource);
  const pending = takePendingUpload(state, mutable);
  if (pending === undefined) return;
  clearQueuedResource(state, mutable);
  publishOutcome(state, "discarded", mutable, pending);
};

export const queueOrdinaryTextureUpload = (
  arena: OrdinaryTextureGpuArena,
  resource: OrdinaryTextureGpuResource,
  upload: OrdinaryTexturePendingUpload,
): boolean => {
  const state = stateOf(arena);
  const mutable = mutableResource(resource);
  if (
    state.resources.get(mutable.key) !== mutable
    || mutable.uploaded
    || mutable.pending !== undefined
    || (mutable.texture !== undefined && !ownsTexture(state.handles, mutable.texture))
  ) return false;
  const cost = ordinaryTextureUploadCost(upload);
  mutable.pending = { cost, upload };
  state.pendingUploadBytes += cost.uploadBytes;
  state.pendingUploads.push(mutable);
  state.wakeRequested = true;
  return true;
};

const canUpload = (state: State, frame: number, budget: number): boolean => {
  if (state.uploadFrame !== frame) {
    state.uploadFrame = frame;
    state.uploadsThisFrame = 0;
  }
  return state.uploadsThisFrame < budget;
};

export const processOrdinaryTextureUploads = (
  arena: OrdinaryTextureGpuArena,
  frame: number,
  generation: number,
  admission?: OrdinaryTextureGpuAdmission,
): void => {
  const state = stateOf(arena);
  let remainingAttempts = state.pendingUploads.length - state.pendingUploadHead;
  while (
    state.pendingUploadHead < state.pendingUploads.length
    && canUpload(state, frame, MAX_UPLOADS_PER_FRAME)
    && remainingAttempts > 0
  ) {
    remainingAttempts -= 1;
    const resource = state.pendingUploads[state.pendingUploadHead];
    if (resource === undefined) {
      state.pendingUploadHead += 1;
      continue;
    }
    const pending = resource.pending;
    if (pending === undefined) {
      state.pendingUploadHead += 1;
      continue;
    }
    if (
      resource.generation !== generation
      || state.resources.get(resource.key) !== resource
      || resource.uploaded
      || (resource.texture !== undefined && !ownsTexture(state.handles, resource.texture))
    ) {
      state.pendingUploadHead += 1;
      takePendingUpload(state, resource);
      publishOutcome(state, "discarded", resource, pending.upload);
      continue;
    }

    const { cost, upload } = pending;
    const admissionResult = admission?.reserve(cost);
    if (admissionResult !== undefined && "reason" in admissionResult) {
      state.pendingUploadHead += 1;
      if (
        admissionResult.reason === "persistent-gpu-cost-exceeds-limit"
        || admissionResult.reason === "upload-cost-exceeds-limit"
      ) {
        takePendingUpload(state, resource);
        publishOversizedOutcome(
          state,
          resource,
          upload,
          admissionResult.reason === "upload-cost-exceeds-limit"
            ? cost.uploadBytes
            : cost.persistentGpuBytes,
          admissionResult.limit,
          admissionResult.reason === "upload-cost-exceeds-limit" ? "upload" : "persistent GPU",
        );
        continue;
      }
      if (admissionResult.reason !== "upload-capacity") state.capacityBlocked = true;
      state.pendingUploads.push(resource);
      if (admissionResult.reason === "upload-capacity") state.wakeRequested = true;
      continue;
    }
    const reservation = admissionResult;
    let texture: WebGLTexture | undefined;
    try {
      texture = createOwnedTexture(state.handles);
      uploadTexture(state.gl, texture, upload.source, upload.texture);
    } catch (error) {
      if (texture === undefined) {
        reservation?.cancel();
      } else {
        // Once allocation/upload begins, conservatively spend this frame's
        // upload budget. A failed deletion retains the durable lease until
        // context loss proves that the driver allocation is gone.
        const failedLease = reservation?.commit();
        try {
          releaseOwnedTexture(state.handles, texture);
        } catch {
          state.quarantinedBytes += cost.persistentGpuBytes;
          if (failedLease !== undefined) state.orphanedLeases.push(failedLease);
          throw error;
        }
        try {
          failedLease?.release();
        } catch {
          if (failedLease !== undefined) state.orphanedLeases.push(failedLease);
        }
      }
      throw error;
    }
    resource.texture = texture;
    resource.gpuBytes = cost.persistentGpuBytes;
    if (reservation !== undefined) resource.lease = reservation.commit();
    state.pendingUploadHead += 1;
    takePendingUpload(state, resource);
    resource.uploaded = true;
    state.uploadsThisFrame += 1;
    publishOutcome(state, "completed", resource, upload);
  }
  if (state.pendingUploadHead >= state.pendingUploads.length) {
    state.pendingUploads.length = 0;
    state.pendingUploadHead = 0;
  } else if (state.pendingUploadHead > 64) {
    state.pendingUploads.splice(0, state.pendingUploadHead);
    state.pendingUploadHead = 0;
  }
  if (
    state.pendingUploadHead < state.pendingUploads.length
    && !canUpload(state, frame, MAX_UPLOADS_PER_FRAME)
  ) state.wakeRequested = true;
};

/** Consumes durable-capacity pressure observed during the latest upload pass. */
export const consumeOrdinaryTextureGpuCapacityBlocked = (
  arena: OrdinaryTextureGpuArena,
): boolean => {
  const state = stateOf(arena);
  const blocked = state.capacityBlocked;
  state.capacityBlocked = false;
  return blocked;
};

const checkedTextureDimension = (value: number, label: string): number => {
  const dimension = Math.ceil(value);
  if (!Number.isSafeInteger(dimension) || dimension < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer, received ${value}`);
  }
  return dimension;
};

export const ordinaryTextureUploadCost = (
  upload: OrdinaryTexturePendingUpload,
): { readonly persistentGpuBytes: number; readonly uploadBytes: number } => {
  const mipmapped = usesMipmaps(upload.texture.sampler?.minFilter);
  if (isDecodedCompressedTexture(upload.source)) {
    const levels = upload.source.levels;
    const levelCount = mipmapped ? levels.length : Math.min(1, levels.length);
    let bytes = 0;
    for (let index = 0; index < levelCount; index += 1) {
      bytes += levels[index]!.data.byteLength;
    }
    if (!Number.isSafeInteger(bytes)) {
      throw new RangeError("ordinary compressed texture byte size exceeds safe integer range");
    }
    return { persistentGpuBytes: bytes, uploadBytes: bytes };
  }
  const size = loadedTextureSourceSize(upload.source);
  let width = checkedTextureDimension(size[0], "ordinary texture width");
  let height = checkedTextureDimension(size[1], "ordinary texture height");
  let persistentGpuBytes = 0;
  let hasLevel = true;
  while (hasLevel) {
    const levelBytes = width * height * 4;
    if (!Number.isSafeInteger(levelBytes) || !Number.isSafeInteger(persistentGpuBytes + levelBytes)) {
      throw new RangeError("ordinary texture byte size exceeds safe integer range");
    }
    persistentGpuBytes += levelBytes;
    hasLevel = mipmapped && (width > 1 || height > 1);
    if (hasLevel) {
      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
  }
  const [sourceWidth, sourceHeight] = size;
  let uploadBytes: number;
  if (isDecodedRgbaTexture(upload.source)) {
    const levels = upload.source.levels;
    uploadBytes = mipmapped && levels !== undefined && decodedTextureHasCompleteMipChain(upload.source)
      ? decodedTextureBytes(upload.source)
      : upload.source.data.byteLength;
  } else {
    uploadBytes = checkedTextureDimension(sourceWidth, "ordinary texture width")
      * checkedTextureDimension(sourceHeight, "ordinary texture height") * 4;
  }
  if (!Number.isSafeInteger(uploadBytes)) {
    throw new RangeError("ordinary texture upload byte size exceeds safe integer range");
  }
  return { persistentGpuBytes, uploadBytes };
};

export const ordinaryTextureGpuHasPendingUploads = (
  arena: OrdinaryTextureGpuArena,
): boolean => {
  const state = stateOf(arena);
  return state.pendingUploadHead < state.pendingUploads.length;
};

/** Decoded bytes waiting for GPU upload; excludes uploaded sources retained for restoration. */
export const ordinaryTextureGpuPendingUploadBytes = (
  arena: OrdinaryTextureGpuArena,
): number => stateOf(arena).pendingUploadBytes;

/** Wakes durable-capacity-denied rows after the root observes capacity being released. */
export const wakeOrdinaryTextureGpuUploads = (
  arena: OrdinaryTextureGpuArena,
): boolean => {
  const state = stateOf(arena);
  if (state.pendingUploadHead >= state.pendingUploads.length) return false;
  state.wakeRequested = true;
  return true;
};

export const consumeOrdinaryTextureGpuWake = (
  arena: OrdinaryTextureGpuArena,
): boolean => {
  const state = stateOf(arena);
  const wake = state.wakeRequested;
  state.wakeRequested = false;
  return wake;
};

export const ordinaryTextureGpuOutcomeCount = (
  arena: OrdinaryTextureGpuArena,
): number => stateOf(arena).outcomes.length;

export const ordinaryTextureGpuOutcome = (
  arena: OrdinaryTextureGpuArena,
  index: number,
): OrdinaryTextureGpuOutcome | undefined => stateOf(arena).outcomes[index];

export const clearOrdinaryTextureGpuOutcomes = (
  arena: OrdinaryTextureGpuArena,
): void => {
  stateOf(arena).outcomes.length = 0;
};

export const releaseOrdinaryTextureGpuResource = (
  arena: OrdinaryTextureGpuArena,
  key: string,
): OrdinaryTextureGpuReleaseResult => {
  const state = stateOf(arena);
  const resource = state.resources.get(key);
  if (resource === undefined) {
    return { releaseError: undefined, releaseErrorPresent: false, released: false };
  }
  state.resources.delete(key);
  const pending = takePendingUpload(state, resource);
  if (pending !== undefined) {
    clearQueuedResource(state, resource);
    publishOutcome(state, "discarded", resource, pending);
  }
  let releaseError: unknown;
  let releaseErrorPresent = false;
  const lease = resource.lease;
  delete resource.lease;
  const releaseLease = (): void => {
    if (lease === undefined) return;
    try {
      lease.release();
    } catch (error) {
      state.orphanedLeases.push(lease);
      releaseError = error;
      releaseErrorPresent = true;
    }
  };
  const texture = resource.texture;
  if (texture === undefined) {
    releaseLease();
    return { releaseError, releaseErrorPresent, released: true };
  }
  try {
    releaseOwnedTexture(state.handles, texture);
  } catch (error) {
    state.quarantinedBytes += resource.gpuBytes;
    if (lease !== undefined) state.orphanedLeases.push(lease);
    if (!releaseErrorPresent) {
      releaseError = error;
      releaseErrorPresent = true;
    }
    return { releaseError, releaseErrorPresent, released: true };
  }
  releaseLease();
  return { releaseError, releaseErrorPresent, released: true };
};

export const dropOrdinaryTextureGpuContext = (
  arena: OrdinaryTextureGpuArena,
): void => {
  const state = stateOf(arena);
  const leases = state.orphanedLeases.splice(0);
  for (const resource of state.resources.values()) {
    const pending = takePendingUpload(state, resource);
    if (pending !== undefined) publishOutcome(state, "retained", resource, pending);
    if (resource.lease !== undefined) leases.push(resource.lease);
    delete resource.lease;
  }
  state.resources.clear();
  state.pendingUploads.length = 0;
  state.pendingUploadHead = 0;
  state.pendingUploadBytes = 0;
  state.quarantinedBytes = 0;
  state.uploadFrame = -1;
  state.uploadsThisFrame = 0;
  state.wakeRequested = false;
  let failure: CapturedFailure | undefined;
  for (const lease of leases) {
    const releaseFailure = captureFailure(() => {
      lease.release();
    });
    if (releaseFailure !== undefined) {
      // A failed lease remains the arena's responsibility for the next drop.
      state.orphanedLeases.push(lease);
    }
    failure ??= releaseFailure;
  }
  if (failure !== undefined) throw failure.value;
};

export const ordinaryTextureGpuResourceCount = (
  arena: OrdinaryTextureGpuArena,
): number => stateOf(arena).resources.size;

export const ordinaryTextureGpuQuarantinedBytes = (
  arena: OrdinaryTextureGpuArena,
): number => stateOf(arena).quarantinedBytes;
