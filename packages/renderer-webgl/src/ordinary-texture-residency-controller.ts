import { DecodedTextureSourceLifetime } from "./decoded-texture-source-lifetime";
import {
  OrdinaryTextureSourceStore,
  type OrdinaryTextureSourceJobAdmission,
  type OrdinaryTextureSourceRequest,
  type OrdinaryTextureSourceStoreSnapshot,
  type OrdinaryTextureSourceSubscription,
} from "./ordinary-texture-source-store";
import {
  releaseResourceArenaPreparedSource,
  resourceArenaPreparedSource,
  resourceArenaPreparedSourceKeys,
  resourceArenaSourceReferenceCount,
  resourceArenaTextureReferenceCount,
  retainResourceArenaPreparedSource,
  retainResourceArenaSourceLease,
  type PreparedTextureSource,
  type ResourceArena,
} from "./resource-arena";
import type { LoadedTextureSource } from "./texture-sources";
import {
  clearOrdinaryTextureGpuOutcomes,
  consumeOrdinaryTextureGpuWake,
  createOrdinaryTextureGpuArena,
  discardOrdinaryTexturePendingUpload,
  dropOrdinaryTextureGpuContext,
  ensureOrdinaryTextureGpuResource,
  ordinaryTextureGpuOutcome,
  ordinaryTextureGpuOutcomeCount,
  ordinaryTextureGpuPendingUpload,
  ordinaryTextureGpuQuarantinedBytes,
  ordinaryTextureGpuResource,
  ordinaryTextureGpuResourceCount,
  processOrdinaryTextureUploads,
  queueOrdinaryTextureUpload,
  releaseOrdinaryTextureGpuResource,
  wakeOrdinaryTextureGpuUploads,
  type OrdinaryTextureGpuAdmission,
  type OrdinaryTextureGpuArena,
  type OrdinaryTextureGpuOutcome,
  type OrdinaryTextureGpuResource,
} from "./webgl/ordinary-texture-gpu-arena";
import { textureCacheKey, type TextureAssetUploadRef } from "./webgl/materials";
import type { TextureHandleArena } from "./webgl/texture-handle-arena";

export type OrdinaryTextureResidencyLifecycle = Readonly<{
  active: boolean;
  disposed: boolean;
  generation: number;
}>;
export type OrdinaryTextureResidencyFailure = Readonly<{ error: unknown }>;
/** Raw GPU work is settled after root-level governor observation. */
export type OrdinaryTextureResidencyGpuReport = Readonly<{
  capacityReleased: boolean;
  operationFailure?: OrdinaryTextureResidencyFailure;
  quarantinedBytesAfter: number;
  quarantinedBytesBefore: number;
  wakeRequested: boolean;
}>;
export type OrdinaryTextureResidencySnapshot = Readonly<{
  quarantinedBytes: number;
  resources: number;
  rows: number;
  sources: OrdinaryTextureSourceStoreSnapshot;
  terminalRows: number;
}>;
export type OrdinaryTextureResidencyControllerOptions = Readonly<{
  admitSourceJob?: () => OrdinaryTextureSourceJobAdmission | undefined;
  decodedSources: DecodedTextureSourceLifetime;
  diagnostic: (message: string, key: string) => void;
  gl: WebGL2RenderingContext;
  invalidate: () => void;
  lifecycle: () => OrdinaryTextureResidencyLifecycle;
  loadSource: (texture: OrdinaryTextureSourceRequest, signal: AbortSignal) => Promise<LoadedTextureSource>;
  registerAutoVirtualTextureDecodedSource: (texture: TextureAssetUploadRef, source: LoadedTextureSource) => void;
  resourceArena: ResourceArena;
  textureHandles: TextureHandleArena;
}>;
type Row = {
  acquisition: number;
  /** `null` means acquire has entered but has not returned its subscription. */
  subscription?: OrdinaryTextureSourceSubscription | null;
  terminal: boolean;
};
type ReportState = OrdinaryTextureResidencyGpuReport & {
  readonly outcomes: readonly OrdinaryTextureGpuOutcome[];
  readonly releasedSource?: LoadedTextureSource;
  settled: boolean;
};
const capture = (operation: () => void): OrdinaryTextureResidencyFailure | undefined => {
  try {
    operation();
  } catch (error) {
    return { error };
  }
  return undefined;
};
const captureNext = (first: OrdinaryTextureResidencyFailure | undefined, operation: () => void) => {
  const next = capture(operation);
  return first ?? next;
};
/** Coordinates existing decoded, prepared, and GPU authorities without replacing them. */
export class OrdinaryTextureResidencyController {
  readonly #gpu: OrdinaryTextureGpuArena;
  readonly #options: OrdinaryTextureResidencyControllerOptions;
  readonly #rows = new Map<string, Row>();
  readonly #sources: OrdinaryTextureSourceStore;
  constructor(options: OrdinaryTextureResidencyControllerOptions) {
    this.#options = options;
    this.#gpu = createOrdinaryTextureGpuArena(options.gl, options.textureHandles);
    this.#sources = new OrdinaryTextureSourceStore({
      ...(options.admitSourceJob === undefined ? {} : { admit: options.admitSourceJob }),
      close: (source) => options.decodedSources.closeOrdinary(source),
      load: options.loadSource,
      retain: (source) => retainResourceArenaSourceLease(options.resourceArena, source),
    });
  }

  request(texture: TextureAssetUploadRef): OrdinaryTextureGpuResource {
    const key = textureCacheKey(texture);
    const cached = ordinaryTextureGpuResource(this.#gpu, key);
    if (cached !== undefined) return cached;
    const row = this.#row(key);
    const lifecycle = this.#options.lifecycle();
    const resource = ensureOrdinaryTextureGpuResource(this.#gpu, key, lifecycle.generation);
    if (row.terminal) return resource;
    const prepared = resourceArenaPreparedSource(this.#options.resourceArena, key);
    if (prepared !== undefined) this.#queue(resource, prepared.source, prepared.texture);
    else if (texture.preparedOnly !== true && row.subscription === undefined) this.#acquire(row, key, texture);
    return resource;
  }

  publishPrepared(texture: TextureAssetUploadRef | undefined, source: LoadedTextureSource): void {
    if (texture === undefined) return;
    const key = textureCacheKey(texture);
    if (resourceArenaTextureReferenceCount(this.#options.resourceArena, key) === 0) return;
    const cached = ordinaryTextureGpuResource(this.#gpu, key);
    const pending = cached === undefined ? undefined : ordinaryTextureGpuPendingUpload(cached);
    if (cached !== undefined && pending !== undefined && pending.source !== source) {
      discardOrdinaryTexturePendingUpload(this.#gpu, cached);
      const failure = this.settleGpuReport(this.#report(false));
      if (failure !== undefined) throw failure.error;
    }
    const row = this.#row(key);
    row.terminal = false;
    this.#releaseSubscription(row);
    this.#retain(key, { source, texture });
    this.#options.registerAutoVirtualTextureDecodedSource(texture, source);
    const lifecycle = this.#options.lifecycle();
    if (!lifecycle.active || cached?.uploaded === true) return;
    this.#queue(cached ?? ensureOrdinaryTextureGpuResource(this.#gpu, key, lifecycle.generation), source, texture);
  }

  restore(): void {
    const lifecycle = this.#options.lifecycle();
    if (!lifecycle.active) return;
    for (const key of resourceArenaPreparedSourceKeys(this.#options.resourceArena)) {
      if (resourceArenaTextureReferenceCount(this.#options.resourceArena, key) === 0) continue;
      const prepared = resourceArenaPreparedSource(this.#options.resourceArena, key);
      if (prepared !== undefined) this.#queue(
        ensureOrdinaryTextureGpuResource(this.#gpu, key, lifecycle.generation),
        prepared.source,
        prepared.texture,
      );
    }
  }

  process(frame: number, generation: number, admission: OrdinaryTextureGpuAdmission): OrdinaryTextureResidencyGpuReport {
    const before = ordinaryTextureGpuQuarantinedBytes(this.#gpu);
    const failure = capture(() => processOrdinaryTextureUploads(this.#gpu, frame, generation, admission));
    return this.#report(false, failure, undefined, before);
  }

  dropContext(): OrdinaryTextureResidencyGpuReport {
    const before = ordinaryTextureGpuQuarantinedBytes(this.#gpu);
    return this.#report(false, capture(() => dropOrdinaryTextureGpuContext(this.#gpu)), undefined, before);
  }

  release(key: string): OrdinaryTextureResidencyGpuReport {
    let failure: OrdinaryTextureResidencyFailure | undefined;
    const row = this.#rows.get(key);
    this.#rows.delete(key);
    const prepared = resourceArenaPreparedSource(this.#options.resourceArena, key);
    releaseResourceArenaPreparedSource(this.#options.resourceArena, key);
    if (row !== undefined) failure = captureNext(failure, () => this.#releaseSubscription(row));
    const before = ordinaryTextureGpuQuarantinedBytes(this.#gpu);
    let capacityReleased = true;
    failure = captureNext(failure, () => {
      const released = releaseOrdinaryTextureGpuResource(this.#gpu, key);
      if (released.releaseError === undefined) return;
      capacityReleased = false;
      throw released.releaseError;
    });
    return this.#report(capacityReleased, failure, prepared?.source, before);
  }

  settleGpuReport(report: OrdinaryTextureResidencyGpuReport): OrdinaryTextureResidencyFailure | undefined {
    const state = report as ReportState;
    if (state.settled) return { error: new Error("Ordinary texture GPU report was already settled") };
    state.settled = true;
    let failure = capture(() => this.#options.decodedSources.retryPendingOrdinary());
    for (const outcome of state.outcomes) {
      if (outcome.kind === "retained") {
        failure = captureNext(failure, () => this.#retain(outcome.key, outcome.upload));
        continue;
      }
      if (outcome.kind === "failed") {
        failure = captureNext(failure, () => {
          this.#options.diagnostic(outcome.message, `ordinary-texture-upload-limit:${outcome.key}`);
        });
        const row = this.#row(outcome.key);
        row.terminal = true;
        const prepared = resourceArenaPreparedSource(this.#options.resourceArena, outcome.key);
        if (prepared?.source === outcome.upload.source) {
          releaseResourceArenaPreparedSource(this.#options.resourceArena, outcome.key);
        }
        failure = captureNext(failure, () => this.#releaseSubscription(row));
      }
      failure = this.#closeIfUnreferenced(outcome.upload.source, failure);
    }
    if (state.releasedSource !== undefined) {
      failure = this.#closeIfUnreferenced(state.releasedSource, failure);
    }
    return failure;
  }

  wakeSourceJobs(): void {
    this.#sources.wake();
  }

  wakeCpuCapacity(): boolean {
    return this.#sources.wakeCpuCapacity();
  }

  wakeGpuCapacity(): boolean {
    return wakeOrdinaryTextureGpuUploads(this.#gpu);
  }

  disposeSources(): void {
    try {
      this.#sources.dispose();
    } finally {
      this.#rows.clear();
    }
  }

  snapshot(): OrdinaryTextureResidencySnapshot {
    let terminalRows = 0;
    for (const row of this.#rows.values()) if (row.terminal) terminalRows += 1;
    return {
      quarantinedBytes: ordinaryTextureGpuQuarantinedBytes(this.#gpu),
      resources: ordinaryTextureGpuResourceCount(this.#gpu),
      rows: this.#rows.size,
      sources: this.#sources.snapshot(),
      terminalRows,
    };
  }

  #acquire(row: Row, key: string, texture: TextureAssetUploadRef): void {
    row.subscription = null;
    const acquisition = ++row.acquisition;
    let subscription: OrdinaryTextureSourceSubscription | undefined;
    try {
      subscription = this.#sources.acquire(texture, (result) => {
        if (!this.#current(key, row, acquisition)) return;
        if (result.kind === "error") {
          const current = ordinaryTextureGpuResource(this.#gpu, key);
          if (this.#options.lifecycle().disposed || current?.uploaded === true) return;
          const detail = result.error instanceof Error ? result.error.message : String(result.error);
          this.#options.diagnostic(`Texture image load failed for ${texture.uri}: ${detail}`, `texture-image:${key}`);
          return;
        }
        const lifecycle = this.#options.lifecycle();
        if (lifecycle.disposed) return;
        this.#options.registerAutoVirtualTextureDecodedSource(texture, result.source);
        if (!this.#current(key, row, acquisition)) return;
        if (resourceArenaTextureReferenceCount(this.#options.resourceArena, key) === 0) return;
        this.#retain(key, { source: result.source, texture });
        if (!lifecycle.active) return;
        const current = ordinaryTextureGpuResource(this.#gpu, key);
        if (current !== undefined && current.generation === lifecycle.generation && !current.uploaded) {
          this.#queue(current, result.source, texture);
        }
      }, { onDeliveryFailure: (delivery) => {
        if (!this.#current(key, row, acquisition)) {
          delivery.terminate();
          return;
        }
        const detail = delivery.error instanceof Error ? delivery.error.message : String(delivery.error);
        capture(() => this.#options.diagnostic(
          `Texture image publication failed for ${texture.uri} on attempt ${delivery.attempt}: ${detail}`,
          `texture-image-publication:${key}`,
        ));
        row.terminal = true;
        delete row.subscription;
        capture(() => delivery.terminate());
        capture(this.#options.invalidate);
      } });
    } finally {
      if (row.subscription === null) delete row.subscription;
    }
    if (subscription === undefined || !this.#current(key, row, acquisition) || row.terminal) {
      subscription?.release();
    } else row.subscription = subscription;
  }

  #closeIfUnreferenced(
    source: LoadedTextureSource,
    first?: OrdinaryTextureResidencyFailure,
  ): OrdinaryTextureResidencyFailure | undefined {
    if (resourceArenaSourceReferenceCount(this.#options.resourceArena, source) !== 0) return first;
    return captureNext(first, () => this.#options.decodedSources.closeOrdinary(source));
  }

  #current(key: string, row: Row, acquisition: number): boolean {
    return this.#rows.get(key) === row && row.acquisition === acquisition;
  }

  #queue(resource: OrdinaryTextureGpuResource, source: LoadedTextureSource, texture: TextureAssetUploadRef): void {
    if (this.#rows.get(resource.key)?.terminal === true) return;
    this.#retain(resource.key, { source, texture });
    const lifecycle = this.#options.lifecycle();
    if (lifecycle.disposed || !lifecycle.active || resource.generation !== lifecycle.generation || resource.uploaded) return;
    queueOrdinaryTextureUpload(this.#gpu, resource, { source, texture });
    if (consumeOrdinaryTextureGpuWake(this.#gpu)) this.#options.invalidate();
  }

  #releaseSubscription(row: Row): void {
    row.acquisition += 1;
    const subscription = row.subscription;
    delete row.subscription;
    subscription?.release();
  }

  #retain(key: string, upload: PreparedTextureSource): void {
    const previous = retainResourceArenaPreparedSource(this.#options.resourceArena, key, upload);
    if (
      previous !== undefined
      && previous.source !== upload.source
      && resourceArenaSourceReferenceCount(this.#options.resourceArena, previous.source) === 0
    ) this.#options.decodedSources.closeOrdinary(previous.source);
  }

  #row(key: string): Row {
    let row = this.#rows.get(key);
    if (row === undefined) {
      row = { acquisition: 0, terminal: false };
      this.#rows.set(key, row);
    }
    return row;
  }

  #report(
    capacityReleased: boolean,
    operationFailure?: OrdinaryTextureResidencyFailure,
    releasedSource?: LoadedTextureSource,
    quarantinedBytesBefore = ordinaryTextureGpuQuarantinedBytes(this.#gpu),
  ): OrdinaryTextureResidencyGpuReport {
    const outcomes: OrdinaryTextureGpuOutcome[] = [];
    for (let index = 0; index < ordinaryTextureGpuOutcomeCount(this.#gpu); index += 1) {
      const outcome = ordinaryTextureGpuOutcome(this.#gpu, index);
      if (outcome !== undefined) outcomes.push(outcome);
    }
    clearOrdinaryTextureGpuOutcomes(this.#gpu);
    return {
      capacityReleased,
      operationFailure,
      outcomes,
      quarantinedBytesAfter: ordinaryTextureGpuQuarantinedBytes(this.#gpu),
      quarantinedBytesBefore,
      releasedSource,
      settled: false,
      wakeRequested: consumeOrdinaryTextureGpuWake(this.#gpu),
    } as ReportState;
  }
}
