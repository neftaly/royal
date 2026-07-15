import { captureFailure, type CapturedFailure } from "./captured-failure";

export interface HdrRenderTarget {
  readonly color: WebGLTexture;
  readonly depth: WebGLRenderbuffer;
  readonly framebuffer: WebGLFramebuffer;
  readonly height: number;
  readonly width: number;
}

export interface ScreenColorTextureResource {
  readonly height: number;
  readonly hdr: boolean;
  readonly originX: number;
  readonly originY: number;
  readonly texture: WebGLTexture;
  readonly uploaded: boolean;
  readonly width: number;
}

export interface SurfaceRenderTargetGpuLease { release(): boolean }
export interface SurfaceRenderTargetGpuReservation {
  cancel(): boolean;
  commit(): SurfaceRenderTargetGpuLease;
}
export interface SurfaceRenderTargetGpuGovernor {
  replace(
    lease: SurfaceRenderTargetGpuLease,
    cost: { readonly persistentGpuBytes: number; readonly transientPeakBytes: number },
  ): SurfaceRenderTargetGpuReservation | undefined;
  reserve(cost: {
    readonly persistentGpuBytes?: number;
    readonly transientPeakBytes?: number;
  }): SurfaceRenderTargetGpuReservation | undefined;
}

declare const authority: unique symbol;
export interface SurfaceRenderTargetArena { readonly [authority]: "SurfaceRenderTargetArena" }
type MutableHdr = { color: WebGLTexture; depth: WebGLRenderbuffer; framebuffer: WebGLFramebuffer; gpuBytes: number; gpuLease?: SurfaceRenderTargetGpuLease; height: number; storageInvalid: boolean; width: number };
type MutableScreen = { gpuBytes: number; gpuLease?: SurfaceRenderTargetGpuLease; height: number; hdr: boolean; originX: number; originY: number; texture: WebGLTexture; uploaded: boolean; width: number };
type State = {
  readonly framebuffers: Set<WebGLFramebuffer>;
  readonly governor?: SurfaceRenderTargetGpuGovernor;
  hdr?: MutableHdr;
  readonly quarantinedLeases: Set<SurfaceRenderTargetGpuLease>;
  readonly renderbuffers: Set<WebGLRenderbuffer>;
  transmission?: MutableScreen;
  readonly textures: Set<WebGLTexture>;
};

export const createSurfaceRenderTargetArena = (
  governor?: SurfaceRenderTargetGpuGovernor,
): SurfaceRenderTargetArena => ({
  framebuffers: new Set(), ...(governor === undefined ? {} : { governor }), quarantinedLeases: new Set(), renderbuffers: new Set(), textures: new Set(),
} as unknown as SurfaceRenderTargetArena);

export interface HdrRenderTargetCapacityPlan {
  readonly height: number;
  readonly reallocate: boolean;
  readonly width: number;
}

/**
 * Keeps small viewport differences inside existing storage while still
 * releasing meaningfully oversized render targets after a resize. Stereo XR
 * viewports can differ by a pixel, so exact-size storage would otherwise be
 * reallocated once per eye and force a synchronous framebuffer validation.
 */
export const planHdrRenderTargetCapacity = (
  currentWidth: number,
  currentHeight: number,
  requestedWidth: number,
  requestedHeight: number,
  storageInvalid: boolean,
): HdrRenderTargetCapacityPlan => {
  if (storageInvalid || currentWidth <= 0 || currentHeight <= 0) {
    return { height: requestedHeight, reallocate: true, width: requestedWidth };
  }
  if (requestedWidth > currentWidth || requestedHeight > currentHeight) {
    return {
      height: Math.max(currentHeight, requestedHeight),
      reallocate: true,
      width: Math.max(currentWidth, requestedWidth),
    };
  }
  if (requestedWidth * 2 <= currentWidth || requestedHeight * 2 <= currentHeight) {
    return { height: requestedHeight, reallocate: true, width: requestedWidth };
  }
  return { height: currentHeight, reallocate: false, width: currentWidth };
};

const checkedBytes = (width: number, height: number, bytesPerPixel: number): number => {
  const value = width * height * bytesPerPixel;
  if (!Number.isSafeInteger(value)) throw new RangeError("Render-target byte size exceeds safe accounting range");
  return value;
};

const reserveStorage = (
  state: State,
  lease: SurfaceRenderTargetGpuLease | undefined,
  bytes: number,
): SurfaceRenderTargetGpuReservation | undefined => {
  if (state.governor === undefined) return undefined;
  const cost = { persistentGpuBytes: bytes, transientPeakBytes: bytes };
  const reservation = lease === undefined
    ? state.governor.reserve(cost)
    : state.governor.replace(lease, cost);
  if (reservation === undefined) throw new Error("Render-target GPU allocation denied by root resource governor");
  return reservation;
};

const dimension = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label} ${value}`);
};
const origin = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} ${value}`);
};
const texture = (state: State, gl: WebGL2RenderingContext): WebGLTexture => {
  const value = gl.createTexture();
  if (value === null) throw new Error("WebGL texture creation failed");
  state.textures.add(value);
  return value;
};
const renderbuffer = (state: State, gl: WebGL2RenderingContext): WebGLRenderbuffer => {
  const value = gl.createRenderbuffer();
  if (value === null) throw new Error("WebGL renderbuffer creation failed");
  state.renderbuffers.add(value);
  return value;
};
const framebuffer = (state: State, gl: WebGL2RenderingContext): WebGLFramebuffer => {
  const value = gl.createFramebuffer();
  if (value === null) throw new Error("WebGL framebuffer creation failed");
  state.framebuffers.add(value);
  return value;
};

export const ensureHdrRenderTarget = (
  arena: SurfaceRenderTargetArena, gl: WebGL2RenderingContext, width: number, height: number,
): HdrRenderTarget => {
  dimension(width, "HDR target width"); dimension(height, "HDR target height");
  const state = arena as unknown as State;
  let target = state.hdr;
  const capacity = planHdrRenderTargetCapacity(
    target?.width ?? 0,
    target?.height ?? 0,
    width,
    height,
    target?.storageInvalid ?? true,
  );
  if (!capacity.reallocate && target !== undefined) return target;
  const bytes = checkedBytes(capacity.width, capacity.height, 11);
  const previousBytes = target?.gpuBytes ?? 0;
  const reservation = reserveStorage(state, target?.gpuLease, bytes);
  let allocationStarted = false;
  if (target === undefined) {
    try {
      const color = texture(state, gl);
      const depth = renderbuffer(state, gl);
      const fb = framebuffer(state, gl);
      target = {
        color, depth, framebuffer: fb, gpuBytes: 0, height: 0, storageInvalid: true, width: 0,
      };
      state.hdr = target;
    } catch (error) {
      reservation?.cancel();
      throw error;
    }
  }
  try {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    allocationStarted = true;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, capacity.width, capacity.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, target.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, capacity.width, capacity.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.color, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Royal physical lighting requires a complete RGBA16F HDR framebuffer");
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    const lease = reservation?.commit();
    if (lease !== undefined) target.gpuLease = lease;
    target.gpuBytes = bytes;
    target.storageInvalid = false;
    target.width = capacity.width; target.height = capacity.height;
    return target;
  } catch (error) {
    target.storageInvalid = true;
    if (allocationStarted && bytes >= previousBytes) {
      const lease = reservation?.commit();
      if (lease !== undefined) target.gpuLease = lease;
      target.gpuBytes = bytes;
    } else {
      // A failed in-place shrink may leave the larger old depth storage beside
      // the smaller new color storage. Preserving the old lease is a safe
      // upper bound; swapping to the smaller lease would undercount it.
      reservation?.cancel();
    }
    throw error;
  }
};

export const copyTransmissionScreenColorTexture = (
  arena: SurfaceRenderTargetArena, gl: WebGL2RenderingContext,
  width: number, height: number, sourceX: number, sourceY: number, hdr: boolean,
): ScreenColorTextureResource => {
  dimension(width, "transmission width"); dimension(height, "transmission height");
  origin(sourceX, "transmission source X"); origin(sourceY, "transmission source Y");
  const state = arena as unknown as State;
  let resource = state.transmission;
  const bytes = checkedBytes(width, height, hdr ? 8 : 4);
  const previousBytes = resource?.gpuBytes ?? 0;
  const allocate = resource === undefined || !resource.uploaded
    || resource.width !== width || resource.height !== height || resource.hdr !== hdr;
  const storageReservation = allocate
    ? reserveStorage(state, resource?.gpuLease, bytes)
    : undefined;
  if (resource === undefined) {
    try {
      const created = texture(state, gl);
      gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, created);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      resource = {
        gpuBytes: 0, height: 0, hdr: false, originX: 0, originY: 0,
        texture: created, uploaded: false, width: 0,
      };
      state.transmission = resource;
    } catch (error) {
      storageReservation?.cancel();
      throw error;
    }
  }
  let allocationStarted = false;
  try {
    gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    if (allocate) {
      allocationStarted = true;
      gl.texImage2D(
        gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA, width, height, 0,
        gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null,
      );
    }
    // This is a GPU-local framebuffer copy, not a CPU-to-GPU upload. Its
    // durable target storage is governed above and its work remains visible to
    // GL tracing; charging the upload budget here can reject otherwise valid
    // transmission frames after unrelated texture uploads.
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sourceX, sourceY, width, height);
    const lease = storageReservation?.commit();
    if (allocate) {
      if (lease !== undefined) resource.gpuLease = lease;
      resource.gpuBytes = bytes;
    }
    resource.width = width; resource.height = height; resource.hdr = hdr;
    resource.originX = sourceX; resource.originY = sourceY; resource.uploaded = true;
    return resource;
  } catch (error) {
    if (allocationStarted) {
      if (bytes >= previousBytes) {
        const lease = storageReservation?.commit();
        if (lease !== undefined) resource.gpuLease = lease;
        resource.gpuBytes = bytes;
      } else {
        // As with HDR, a driver throw may leave the prior larger allocation
        // intact. Keep its lease rather than replacing it with a smaller one.
        storageReservation?.cancel();
      }
    } else {
      storageReservation?.cancel();
    }
    throw error;
  }
};

export const releaseSurfaceRenderTargetContextHandles = (
  arena: SurfaceRenderTargetArena, gl: WebGL2RenderingContext,
): void => {
  const state = arena as unknown as State;
  let failure: { readonly value: unknown } | undefined;
  const attempt = (action: () => void): void => {
    try { action(); } catch (value) { failure ??= { value }; }
  };
  for (const value of state.framebuffers) attempt(() => {
    gl.deleteFramebuffer(value); state.framebuffers.delete(value);
  });
  for (const value of state.renderbuffers) attempt(() => {
    gl.deleteRenderbuffer(value); state.renderbuffers.delete(value);
  });
  for (const value of state.textures) attempt(() => {
    gl.deleteTexture(value); state.textures.delete(value);
  });
  const hdr = state.hdr;
  if (hdr !== undefined) {
    if (!state.renderbuffers.has(hdr.depth) && !state.textures.has(hdr.color)) {
      hdr.gpuLease?.release();
      delete hdr.gpuLease;
      hdr.gpuBytes = 0;
    }
    if (!state.framebuffers.has(hdr.framebuffer)
      && !state.renderbuffers.has(hdr.depth) && !state.textures.has(hdr.color)) delete state.hdr;
  }
  const transmission = state.transmission;
  if (transmission !== undefined && !state.textures.has(transmission.texture)) {
    transmission.gpuLease?.release();
    delete transmission.gpuLease;
    delete state.transmission;
  }
  if (failure !== undefined) throw failure.value;
};

export const dropSurfaceRenderTargetArenaContext = (
  arena: SurfaceRenderTargetArena,
  contextStorageGone = true,
): void => {
  const state = arena as unknown as State;
  let failure: CapturedFailure | undefined;
  const release = (lease: SurfaceRenderTargetGpuLease): void => {
    const releaseFailure = captureFailure(() => {
      lease.release();
      state.quarantinedLeases.delete(lease);
    });
    if (releaseFailure !== undefined) state.quarantinedLeases.add(lease);
    failure ??= releaseFailure;
  };
  const previouslyQuarantined = [...state.quarantinedLeases];
  for (const lease of [state.hdr?.gpuLease, state.transmission?.gpuLease]) {
    if (lease === undefined) continue;
    if (contextStorageGone) release(lease);
    else state.quarantinedLeases.add(lease);
  }
  if (contextStorageGone) {
    for (const lease of previouslyQuarantined) release(lease);
  }
  state.framebuffers.clear(); state.renderbuffers.clear(); state.textures.clear();
  delete state.hdr; delete state.transmission;
  if (failure !== undefined) throw failure.value;
};
