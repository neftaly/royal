import type { LoadedTextureSource } from "../texture-sources";
import type { TextureAssetUploadRef } from "./materials";
import {
  createOwnedTexture,
  ownsTexture,
  releaseOwnedTexture,
  type TextureHandleArena,
} from "./texture-handle-arena";
import { uploadTexture } from "./texture-upload";

const MAX_UPLOADS_PER_FRAME = 1;

declare const authority: unique symbol;

export interface OrdinaryTextureGpuArena {
  readonly [authority]: "OrdinaryTextureGpuArena";
}

export interface OrdinaryTextureGpuResource {
  readonly generation: number;
  readonly key: string;
  readonly texture: WebGLTexture;
  readonly uploaded: boolean;
}

export interface OrdinaryTexturePendingUpload {
  readonly source: LoadedTextureSource;
  readonly texture: TextureAssetUploadRef;
}

export interface OrdinaryTextureGpuReleaseResult {
  readonly releaseError?: unknown;
}

export type OrdinaryTextureGpuOutcome = {
  readonly kind: "completed" | "discarded" | "retained";
  readonly key: string;
  readonly upload: OrdinaryTexturePendingUpload;
};

type MutableResource = {
  readonly generation: number;
  readonly key: string;
  pendingUpload?: OrdinaryTexturePendingUpload;
  readonly texture: WebGLTexture;
  uploaded: boolean;
};

type State = {
  readonly gl: WebGL2RenderingContext;
  readonly handles: TextureHandleArena;
  readonly outcomes: OrdinaryTextureGpuOutcome[];
  readonly pendingUploads: Array<MutableResource | undefined>;
  pendingUploadHead: number;
  readonly resources: Map<string, MutableResource>;
  uploadFrame: number;
  uploadsThisFrame: number;
  wakeRequested: boolean;
};

const stateOf = (arena: OrdinaryTextureGpuArena): State => arena as unknown as State;
const mutableResource = (resource: OrdinaryTextureGpuResource): MutableResource =>
  resource as MutableResource;

export const createOrdinaryTextureGpuArena = (
  gl: WebGL2RenderingContext,
  handles: TextureHandleArena,
): OrdinaryTextureGpuArena => ({
  gl,
  handles,
  outcomes: [],
  pendingUploadHead: 0,
  pendingUploads: [],
  resources: new Map(),
  uploadFrame: -1,
  uploadsThisFrame: 0,
  wakeRequested: false,
} as unknown as OrdinaryTextureGpuArena);

export const ordinaryTextureGpuResource = (
  arena: OrdinaryTextureGpuArena,
  key: string,
): OrdinaryTextureGpuResource | undefined => stateOf(arena).resources.get(key);

export const ordinaryTextureGpuPendingUpload = (
  resource: OrdinaryTextureGpuResource,
): OrdinaryTexturePendingUpload | undefined => mutableResource(resource).pendingUpload;

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
    return existing;
  }
  const resource: MutableResource = {
    generation,
    key,
    texture: createOwnedTexture(state.handles),
    uploaded: false,
  };
  state.resources.set(key, resource);
  return resource;
};

const publishOutcome = (
  state: State,
  kind: OrdinaryTextureGpuOutcome["kind"],
  resource: MutableResource,
  upload: OrdinaryTexturePendingUpload,
): void => {
  state.outcomes.push({ key: resource.key, kind, upload });
};

const clearQueuedResource = (state: State, resource: MutableResource): void => {
  for (let index = state.pendingUploadHead; index < state.pendingUploads.length; index += 1) {
    if (state.pendingUploads[index] === resource) state.pendingUploads[index] = undefined;
  }
};

export const discardOrdinaryTexturePendingUpload = (
  arena: OrdinaryTextureGpuArena,
  resource: OrdinaryTextureGpuResource,
): void => {
  const state = stateOf(arena);
  const mutable = mutableResource(resource);
  const pending = mutable.pendingUpload;
  if (pending === undefined) return;
  delete mutable.pendingUpload;
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
    || mutable.pendingUpload !== undefined
    || !ownsTexture(state.handles, mutable.texture)
  ) return false;
  mutable.pendingUpload = upload;
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
): void => {
  const state = stateOf(arena);
  while (
    state.pendingUploadHead < state.pendingUploads.length
    && canUpload(state, frame, MAX_UPLOADS_PER_FRAME)
  ) {
    const resource = state.pendingUploads[state.pendingUploadHead];
    if (resource === undefined) {
      state.pendingUploadHead += 1;
      continue;
    }
    const pending = resource.pendingUpload;
    if (pending === undefined) {
      state.pendingUploadHead += 1;
      continue;
    }
    if (
      resource.generation !== generation
      || state.resources.get(resource.key) !== resource
      || resource.uploaded
      || !ownsTexture(state.handles, resource.texture)
    ) {
      state.pendingUploadHead += 1;
      delete resource.pendingUpload;
      publishOutcome(state, "discarded", resource, pending);
      continue;
    }

    uploadTexture(state.gl, resource.texture, pending.source, pending.texture);
    state.pendingUploadHead += 1;
    delete resource.pendingUpload;
    resource.uploaded = true;
    state.uploadsThisFrame += 1;
    publishOutcome(state, "completed", resource, pending);
  }
  if (state.pendingUploadHead >= state.pendingUploads.length) {
    state.pendingUploads.length = 0;
    state.pendingUploadHead = 0;
  }
  if (state.pendingUploadHead < state.pendingUploads.length) state.wakeRequested = true;
};

export const ordinaryTextureGpuHasPendingUploads = (
  arena: OrdinaryTextureGpuArena,
): boolean => {
  const state = stateOf(arena);
  return state.pendingUploadHead < state.pendingUploads.length;
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
  if (resource === undefined) return {};
  state.resources.delete(key);
  const pending = resource.pendingUpload;
  if (pending !== undefined) {
    delete resource.pendingUpload;
    clearQueuedResource(state, resource);
    publishOutcome(state, "discarded", resource, pending);
  }
  try {
    releaseOwnedTexture(state.handles, resource.texture);
    return {};
  } catch (releaseError) {
    return { releaseError };
  }
};

export const dropOrdinaryTextureGpuContext = (
  arena: OrdinaryTextureGpuArena,
): void => {
  const state = stateOf(arena);
  for (const resource of state.resources.values()) {
    const pending = resource.pendingUpload;
    if (pending !== undefined) publishOutcome(state, "retained", resource, pending);
    delete resource.pendingUpload;
  }
  state.resources.clear();
  state.pendingUploads.length = 0;
  state.pendingUploadHead = 0;
  state.uploadFrame = -1;
  state.uploadsThisFrame = 0;
  state.wakeRequested = false;
};

export const ordinaryTextureGpuResourceCount = (
  arena: OrdinaryTextureGpuArena,
): number => stateOf(arena).resources.size;
