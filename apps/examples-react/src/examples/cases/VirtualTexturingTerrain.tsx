import {
  type VirtualTexturePageAddress,
  type VirtualTexturePageId,
} from '@royal/renderer-webgl/virtual-texturing';
// Temporary: this demo still depends on low-level VT mechanics while it migrates to the public resource facade.
import {
  VirtualTextureRuntime,
  createVirtualTexturePageTableTexture,
  planVirtualTextureUploads,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageId,
  virtualTexturePageTableMipDimensions,
  type VirtualTextureDebugSnapshot,
  type VirtualTexturePageTableTexture,
  type VirtualTexturePageTableTexelUpload,
  type VirtualTexturePhysicalAtlasPageUpload,
} from '@royal/renderer-webgl/virtual-texturing/testing';
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import {
  createWorkerBackedTerrainPageGenerator,
  type PreparedTerrainPageUpload,
  type WorkerBackedTerrainPageGenerator,
} from './virtual-texturing/worker-page-adapter';
import {
  createTerrainPhysicalPagePixels as createGeneratedVirtualTexturePagePixels,
} from './virtual-texturing/terrain-page-generator';

type PhysicalAtlasTexture = {
  readonly slotColumns: number;
  readonly slotRows: number;
  readonly texture: WebGLTexture;
};

type VirtualTextureRuntimeStats = ReturnType<VirtualTextureRuntime['stats']>;

type PageTableReadback = {
  readonly nonZeroTexels: number;
  readonly texels: number;
  readonly uniqueEntries: number;
};

type CanvasReadback = {
  readonly colorBuckets: number;
  readonly paintedRatio: number;
};

type CameraProbe = {
  readonly distance: number;
  readonly inputEvents: number;
  readonly interactionActive: boolean;
  readonly lastInteractionAgoMs: number;
  readonly moved: boolean;
  readonly pitch: number;
  readonly revision: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly yaw: number;
};

type VirtualTextureDetailProbe = {
  readonly baseResolveCount: number;
  readonly effectiveVirtualResolution: number;
  readonly focusU: number;
  readonly focusV: number;
  readonly maxResidentDetail: number;
  readonly maxResidentMip: number;
  readonly requestSignature: string;
  readonly requestedMip: number;
  readonly requestedPageIds: readonly VirtualTexturePageId[];
  readonly requestedPages: number;
};

type VirtualTexturePerformanceProbe = {
  advanceCount: number;
  buffersAllocated: number;
  buffersReused: number;
  cacheChurnCount: number;
  cacheChurnRatio: number;
  cacheThrashCount: number;
  evictionCount: number;
  exactHitRatio: number;
  frameTimeP95Ms: number;
  frameTimeSamples: number[];
  fullPageTableRebuildsAfterInit: number;
  inFlightBytes: number;
  lastAdvanceMs: number;
  lastAllocationMs: number;
  lastAtlasUploadCount: number;
  lastFillMs: number;
  lastFrameMs: number;
  lastPageGenerationMs: number;
  lastPlanMs: number;
  lastReadbackMs: number;
  lastPageTableUploadCount: number;
  lastPageTableUploadMs: number;
  lastResolvedBasePages: number;
  lastSchedulerDelayMs: number;
  lastWorkChunkMs: number;
  lastTextureUploadMs: number;
  lastWorkerGenerationLatencyMs: number;
  maxAdvanceMs: number;
  maxAllocationMs: number;
  maxFillMs: number;
  maxFrameMs: number;
  maxPageGenerationMs: number;
  maxPlanMs: number;
  maxReadbackMs: number;
  maxPageTableUploadMs: number;
  maxSchedulerDelayMs: number;
  maxWorkChunkMs: number;
  maxTextureUploadMs: number;
  maxWorkerGenerationLatencyMs: number;
  oldestQueuedWorkFrames: number;
  pendingPages: number;
  pendingReadbacks: number;
  protectedPageEvictions: number;
  protectedPages: number;
  queueDepth: number;
  readbackCount: number;
  recentEvictionReRequestRatio: number;
  repeatedDropCount: number;
  repeatedReloadRatio: number;
  repeatedRequestCount: number;
  schedulerChunkCount: number;
  schedulerStrategy: VirtualTextureWorkSchedulerStrategy;
  slowFrameBudgetMs: number;
  slowFrameCount: number;
  staleDrops: number;
  staleAtlasUploadDrops: number;
  stalePageTableUploadDrops: number;
  staleQueuedDrops: number;
  uploadChurnCount: number;
  uploadChurnRatio: number;
  uploadThrashCount: number;
  workerAvailable: boolean;
  workerCount: number;
  workerFallbackPages: number;
  workerGeneratedPages: number;
  workerLastError: string;
  workChunkBudgetMs: number;
};

type VirtualTextureProbe = {
  atlasPreviewReadback: CanvasReadback;
  bytesUploaded: number;
  camera: CameraProbe;
  canvasReadback: CanvasReadback;
  detail: VirtualTextureDetailProbe;
  drawCalls: number;
  error: string;
  evictedPageIds: readonly VirtualTexturePageId[];
  exactPageCount: number;
  fallbackPageCount: number;
  frameCount: number;
  lastPageTableUploadSample: readonly number[];
  lastPhysicalAtlasUpload: string;
  mode: 'webgl2-virtual-texture' | 'webgl2-unavailable';
  pageTablePreviewReadback: CanvasReadback;
  pageTableReadback: PageTableReadback;
  pageTableTexelUploads: number;
  performance: VirtualTexturePerformanceProbe;
  physicalAtlasUploads: number;
  previewDrawCalls: number;
  ready: boolean;
  residentPageIds: readonly VirtualTexturePageId[];
  supported: boolean;
  terrainDrawCalls: number;
  terrainReadback: CanvasReadback;
};

type TerrainMesh = {
  readonly indexBuffer: WebGLBuffer;
  readonly indexCount: number;
  readonly vertexBuffer: WebGLBuffer;
  readonly vao: WebGLVertexArrayObject;
};

type FullscreenQuad = {
  readonly buffer: WebGLBuffer;
  readonly vao: WebGLVertexArrayObject;
};

type TerrainProgram = {
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly atlasSlots: WebGLUniformLocation;
    readonly lightDirection: WebGLUniformLocation;
    readonly pageTable: WebGLUniformLocation;
    readonly pageTableSize: WebGLUniformLocation;
    readonly physicalAtlas: WebGLUniformLocation;
    readonly viewProjection: WebGLUniformLocation;
  };
};

type PreviewProgram = {
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly atlasSlots: WebGLUniformLocation;
    readonly gridSize: WebGLUniformLocation;
    readonly mode: WebGLUniformLocation;
    readonly texture: WebGLUniformLocation;
  };
};

type CameraState = {
  distance: number;
  inputEvents: number;
  interactionActive: boolean;
  lastTime: number;
  lastInteractionTime: number;
  moved: boolean;
  pitch: number;
  revision: number;
  targetX: number;
  targetZ: number;
  yaw: number;
};

type CameraController = {
  readonly dispose: () => void;
  readonly state: CameraState;
  readonly update: (now: number) => void;
};

type PhysicalAtlasUploadStats = {
  readonly allocationMs: number;
  readonly bytesUploaded: number;
  readonly fillMs: number;
  readonly generationMs: number;
  readonly pagesUploaded: number;
  readonly uploadMs: number;
  readonly workerLatencyMs: number;
};

type PhysicalPagePixels = {
  readonly allocationMs: number;
  readonly fillMs: number;
  readonly pixels: Uint8Array;
};

type QueuedWorkPriority = 'background' | 'fallback' | 'visible';

type HeldFocusPage = {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
};

type QueuedPageTableUpload = {
  readonly priority: QueuedWorkPriority;
  readonly queuedFrame: number;
  readonly requestSignature: string;
  readonly upload: VirtualTexturePageTableTexelUpload;
  readonly uploadSerial: number | null;
};

type QueuedPhysicalAtlasUpload = {
  readonly priority: QueuedWorkPriority;
  readonly queuedFrame: number;
  readonly requestSignature: string;
  readonly upload: VirtualTexturePhysicalAtlasPageUpload;
};

type ProtectedVirtualTexturePage = {
  readonly page: VirtualTexturePageAddress;
  lastRequestedFrame: number;
};

type VirtualTextureReadbackRequest = {
  readonly height: number;
  readonly width: number;
};

type ProbePreviewTarget = {
  readonly framebuffer: WebGLFramebuffer;
  readonly height: number;
  readonly texture: WebGLTexture;
  readonly width: number;
};

type ProbePreviewTargets = {
  readonly atlas: ProbePreviewTarget;
  readonly pageTable: ProbePreviewTarget;
};

type PendingVirtualTextureWork = {
  evictedPageIds: Set<VirtualTexturePageId>;
  fallbackPageTableUploads: QueuedPageTableUpload[];
  heldDetail: number | null;
  heldFocus: HeldFocusPage | null;
  initialBaseResolveCursor: number;
  lastCameraRevision: number;
  lastMaxResidentDetail: number;
  lastRequestSignature: string;
  pageTableUploads: QueuedPageTableUpload[];
  pendingReadback: VirtualTextureReadbackRequest | null;
  pendingAtlasResidentIds: Set<VirtualTexturePageId>;
  pendingAtlasUploadKeys: Set<string>;
  physicalAtlasUploads: QueuedPhysicalAtlasUpload[];
  protectedPages: Map<VirtualTexturePageId, ProtectedVirtualTexturePage>;
  priorityBaseResolveIds: Set<VirtualTexturePageId>;
  priorityBaseResolves: VirtualTexturePageAddress[];
  priorityPageTableUploads: QueuedPageTableUpload[];
  requestSignatureCounts: Map<string, number>;
  uploadedAtlasUploadKeys: Set<string>;
  uploadedResidentIds: Set<VirtualTexturePageId>;
  visiblePages: VirtualTexturePageAddress[];
};

type VirtualTextureDemoSettings = {
  readonly maxResidentDetail: number;
};

type VirtualTextureMaterialRequestContext = {
  readonly camera: CameraState;
  readonly frame: number;
  readonly heldDetail: number | null;
  readonly heldFocus: HeldFocusPage | null;
  readonly maxResidentDetail: number;
};

type VirtualTextureMaterialRequestPlan = {
  readonly basePagesToResolve: readonly VirtualTexturePageAddress[];
  readonly detail: VirtualTextureDetailProbe;
  readonly fallbackPagesToMakeResident: readonly VirtualTexturePageAddress[];
  readonly heldDetail: number;
  readonly heldFocus: HeldFocusPage;
  readonly pagesToMakeResident: readonly VirtualTexturePageAddress[];
  readonly visiblePagesToMakeResident: readonly VirtualTexturePageAddress[];
};

type VirtualTextureMaterialAdapter = {
  readonly createPagePixels: (upload: VirtualTexturePhysicalAtlasPageUpload) => PhysicalPagePixels;
  readonly pageGenerator: WorkerBackedTerrainPageGenerator;
  readonly planRequests: (context: VirtualTextureMaterialRequestContext) => VirtualTextureMaterialRequestPlan;
};

type Vec3 = readonly [number, number, number];

type BrowserTaskScheduler = {
  readonly postTask?: (
    callback: () => void,
    options?: { readonly priority?: 'background' | 'user-blocking' | 'user-visible' },
  ) => Promise<unknown>;
};

type IdleSchedulerWindow = Window & {
  readonly cancelIdleCallback?: (handle: number) => void;
  readonly requestIdleCallback?: (
    callback: (deadline: { readonly didTimeout: boolean; readonly timeRemaining: () => number }) => void,
    options?: { readonly timeout?: number },
  ) => number;
  readonly scheduler?: BrowserTaskScheduler;
};

type VirtualTextureWorkSchedulerStrategy = 'idle-callback' | 'post-task' | 'set-timeout';

declare global {
  interface Window {
    __royalVirtualTextureProbe?: VirtualTextureProbe;
  }
}

const virtualSize = [4096, 4096] as const;
const pageSize = 64;
const basePageColumns = virtualSize[0] / pageSize;
const basePageRows = virtualSize[1] / pageSize;
const maxVirtualMip = Math.round(Math.log2(Math.max(basePageColumns, basePageRows)));
const defaultMaxResidentDetail = maxVirtualMip;
const physicalSlots = 64;
const terrainSegments = 1;
const terrainWorldSize = 8.5;
const terrainPanLimit = 2.4;
const terrainVertexStride = 8;
const atlasProbePreviewSize = 160;
const pageTableProbePreviewSize = 128;
const minCameraDistance = 0.85;
const fullDetailCameraDistance = 2.4;
const maxCameraDistance = 12;
const detailRequestRadius = 1;
const frameTimeSampleLimit = 180;
const maxBaseResolvesPerChunk = 256;
const maxBackgroundPageTableBacklog = 96;
const maxInteractiveWorkBeforeBackground = 32;
const maxPageTableTexelUploadsPerChunk = 96;
const maxPhysicalAtlasUploadsPerChunk = 1;
const maxWorkerQueuedAtlasUploads = 12;
const probeReadbackIntervalMs = 500;
const textureWorkChunkBudgetMs = 2.5;
const interactiveTextureWorkChunkBudgetMs = 1.25;
const textureWorkIdleTimeoutMs = 120;
const interactionReadbackQuietMs = 240;
const slowFrameBudgetMs = 34;
const zoomDetailDeadband = 0.58;
const focusPageDeadband = 0.62;
const protectedPageHoldFrames = 90;
const maxProtectedPages = physicalSlots;
const rootPage: VirtualTexturePageAddress = { mip: maxVirtualMip, x: 0, y: 0 };
const basePages = Array.from({ length: basePageColumns * basePageRows }, (_, index): VirtualTexturePageAddress => ({
  mip: 0,
  x: index % basePageColumns,
  y: Math.floor(index / basePageColumns),
}));
const rootOptions = {
  alpha: false,
  antialias: true,
  preserveDrawingBuffer: true,
} as const;
const terrainVertexShaderSource = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;

uniform mat4 u_viewProjection;

out vec3 v_normal;
out vec2 v_uv;

void main() {
  v_normal = a_normal;
  v_uv = a_uv;
  gl_Position = u_viewProjection * vec4(a_position, 1.0);
}
`;
const terrainFragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D u_pageTable;
uniform sampler2D u_physicalAtlas;
uniform vec2 u_atlasSlots;
uniform vec2 u_pageTableSize;
uniform vec3 u_lightDirection;

in vec3 v_normal;
in vec2 v_uv;
out vec4 outColor;

vec3 sampleVirtualTexture(
  vec2 uv,
  out float pageLine,
  out float fallbackAmount
) {
  vec2 sampledVirtualPage = min(floor(uv * u_pageTableSize), u_pageTableSize - vec2(1.0));
  vec2 sampledPageUv = fract(uv * u_pageTableSize);
  vec4 entry = texelFetch(u_pageTable, ivec2(sampledVirtualPage), 0);
  float valid = step(0.5 / 255.0, entry.a);
  vec2 slot = floor(entry.rg * 255.0 + 0.5);
  float mipDelta = max(1.0, exp2(floor(entry.b * 255.0 + 0.5)));
  vec2 fallbackOffset = mod(sampledVirtualPage, mipDelta) / mipDelta;
  vec2 atlasUv = (slot + fallbackOffset + sampledPageUv / mipDelta) / u_atlasSlots;
  vec3 atlasColor = texture(u_physicalAtlas, atlasUv).rgb;
  float edgeDistance = min(
    min(sampledPageUv.x, sampledPageUv.y),
    min(1.0 - sampledPageUv.x, 1.0 - sampledPageUv.y)
  );

  pageLine = 1.0 - smoothstep(0.0, 0.018, edgeDistance);
  fallbackAmount = clamp(log2(mipDelta) / 6.0, 0.0, 1.0);
  return mix(vec3(0.16, 0.025, 0.055), atlasColor, valid);
}

void main() {
  float pageLine = 0.0;
  float fallbackAmount = 0.0;
  vec2 vtUv = clamp(v_uv, vec2(0.0), vec2(1.0));
  vec3 textureColor = sampleVirtualTexture(
    vtUv,
    pageLine,
    fallbackAmount
  );
  vec3 normal = normalize(v_normal);
  float light = clamp(dot(normal, normalize(u_lightDirection)), 0.0, 1.0);
  vec3 fallbackTint = mix(vec3(0.52, 0.48, 0.68), vec3(1.0), 1.0 - fallbackAmount);
  vec3 shaded = textureColor * fallbackTint * (0.74 + light * 0.26);
  shaded = mix(shaded, vec3(0.92, 0.97, 1.0), pageLine * 0.36);

  outColor = vec4(shaded, 1.0);
}
`;
const previewVertexShaderSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
const previewFragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_atlasSlots;
uniform vec2 u_gridSize;
uniform int u_mode;

in vec2 v_uv;
out vec4 outColor;

vec3 pageTableColor(vec4 entry) {
  float valid = step(0.5 / 255.0, entry.a);
  vec2 slot = floor(entry.rg * 255.0 + 0.5);
  float mipDelta = floor(entry.b * 255.0 + 0.5);
  vec3 slotColor = vec3(
    (slot.x + 0.35) / max(u_atlasSlots.x, 1.0),
    (slot.y + 0.35) / max(u_atlasSlots.y, 1.0),
    1.0 - min(mipDelta * 0.24, 0.72)
  );

  return mix(vec3(0.16, 0.025, 0.055), slotColor, valid);
}

void main() {
  vec4 sampleColor = texture(u_texture, v_uv);
  vec3 color = u_mode == 1 ? pageTableColor(sampleColor) : sampleColor.rgb;
  vec2 gridUv = fract(v_uv * max(u_gridSize, vec2(1.0)));
  float gridDistance = min(min(gridUv.x, gridUv.y), min(1.0 - gridUv.x, 1.0 - gridUv.y));
  float grid = 1.0 - smoothstep(0.0, 0.025, gridDistance);
  float borderDistance = min(min(v_uv.x, v_uv.y), min(1.0 - v_uv.x, 1.0 - v_uv.y));
  float border = 1.0 - smoothstep(0.0, 0.035, borderDistance);
  color = mix(color, vec3(0.02, 0.035, 0.045), 0.16);
  color = mix(color, vec3(0.9, 0.96, 1.0), min(1.0, grid * 0.45 + border * 0.72));

  outColor = vec4(color, 1.0);
}
`;

const emptyReadback = (): CanvasReadback => ({ colorBuckets: 0, paintedRatio: 0 });

const emptyCameraProbe = (): CameraProbe => ({
  distance: 0,
  inputEvents: 0,
  interactionActive: false,
  lastInteractionAgoMs: 0,
  moved: false,
  pitch: 0,
  revision: 0,
  targetX: 0,
  targetZ: 0,
  yaw: 0,
});

const emptyDetailProbe = (): VirtualTextureDetailProbe => ({
  baseResolveCount: 0,
  effectiveVirtualResolution: 0,
  focusU: 0,
  focusV: 0,
  maxResidentDetail: defaultMaxResidentDetail,
  maxResidentMip: rootPage.mip,
  requestSignature: '',
  requestedMip: rootPage.mip,
  requestedPageIds: [],
  requestedPages: 0,
});

const emptyPerformanceProbe = (): VirtualTexturePerformanceProbe => ({
  advanceCount: 0,
  buffersAllocated: 0,
  buffersReused: 0,
  cacheChurnCount: 0,
  cacheChurnRatio: 0,
  cacheThrashCount: 0,
  evictionCount: 0,
  exactHitRatio: 1,
  frameTimeP95Ms: 0,
  frameTimeSamples: [],
  fullPageTableRebuildsAfterInit: 0,
  inFlightBytes: 0,
  lastAdvanceMs: 0,
  lastAllocationMs: 0,
  lastAtlasUploadCount: 0,
  lastFillMs: 0,
  lastFrameMs: 0,
  lastPageGenerationMs: 0,
  lastPlanMs: 0,
  lastReadbackMs: 0,
  lastPageTableUploadCount: 0,
  lastPageTableUploadMs: 0,
  lastResolvedBasePages: 0,
  lastSchedulerDelayMs: 0,
  lastWorkChunkMs: 0,
  lastTextureUploadMs: 0,
  lastWorkerGenerationLatencyMs: 0,
  maxAdvanceMs: 0,
  maxAllocationMs: 0,
  maxFillMs: 0,
  maxFrameMs: 0,
  maxPageGenerationMs: 0,
  maxPlanMs: 0,
  maxReadbackMs: 0,
  maxPageTableUploadMs: 0,
  maxSchedulerDelayMs: 0,
  maxWorkChunkMs: 0,
  maxTextureUploadMs: 0,
  maxWorkerGenerationLatencyMs: 0,
  oldestQueuedWorkFrames: 0,
  pendingPages: 0,
  pendingReadbacks: 0,
  protectedPageEvictions: 0,
  protectedPages: 0,
  queueDepth: 0,
  readbackCount: 0,
  recentEvictionReRequestRatio: 0,
  repeatedDropCount: 0,
  repeatedReloadRatio: 0,
  repeatedRequestCount: 0,
  schedulerChunkCount: 0,
  schedulerStrategy: 'set-timeout',
  slowFrameBudgetMs,
  slowFrameCount: 0,
  staleDrops: 0,
  staleAtlasUploadDrops: 0,
  stalePageTableUploadDrops: 0,
  staleQueuedDrops: 0,
  uploadChurnCount: 0,
  uploadChurnRatio: 0,
  uploadThrashCount: 0,
  workerAvailable: false,
  workerCount: 0,
  workerFallbackPages: 0,
  workerGeneratedPages: 0,
  workerLastError: '',
  workChunkBudgetMs: textureWorkChunkBudgetMs,
});

const emptyProbe = (): VirtualTextureProbe => ({
  atlasPreviewReadback: emptyReadback(),
  bytesUploaded: 0,
  camera: emptyCameraProbe(),
  canvasReadback: emptyReadback(),
  detail: emptyDetailProbe(),
  drawCalls: 0,
  error: '',
  evictedPageIds: [],
  exactPageCount: 0,
  fallbackPageCount: 0,
  frameCount: 0,
  lastPageTableUploadSample: [],
  lastPhysicalAtlasUpload: '',
  mode: 'webgl2-unavailable',
  pageTablePreviewReadback: emptyReadback(),
  pageTableReadback: { nonZeroTexels: 0, texels: 0, uniqueEntries: 0 },
  pageTableTexelUploads: 0,
  performance: emptyPerformanceProbe(),
  physicalAtlasUploads: 0,
  previewDrawCalls: 0,
  ready: false,
  residentPageIds: [],
  supported: false,
  terrainDrawCalls: 0,
  terrainReadback: emptyReadback(),
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeVec3 = (value: Vec3): Vec3 => {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
};

const crossVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const dotVec3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const subtractVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const perspectiveMatrix = (fovY: number, aspect: number, near: number, far: number): Float32Array => {
  const f = 1 / Math.tan(fovY / 2);
  const range = 1 / (near - far);

  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * range,
    -1,
    0,
    0,
    2 * far * near * range,
    0,
  ]);
};

const lookAtMatrix = (eye: Vec3, target: Vec3, up: Vec3): Float32Array => {
  const zAxis = normalizeVec3(subtractVec3(eye, target));
  const xAxis = normalizeVec3(crossVec3(up, zAxis));
  const yAxis = crossVec3(zAxis, xAxis);

  return new Float32Array([
    xAxis[0],
    yAxis[0],
    zAxis[0],
    0,
    xAxis[1],
    yAxis[1],
    zAxis[1],
    0,
    xAxis[2],
    yAxis[2],
    zAxis[2],
    0,
    -dotVec3(xAxis, eye),
    -dotVec3(yAxis, eye),
    -dotVec3(zAxis, eye),
    1,
  ]);
};

const matrixValue = (matrix: Float32Array, index: number): number => matrix[index] ?? 0;

const multiplyMatrix = (a: Float32Array, b: Float32Array): Float32Array => {
  const out = new Float32Array(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        matrixValue(a, row) * matrixValue(b, column * 4) +
        matrixValue(a, 4 + row) * matrixValue(b, column * 4 + 1) +
        matrixValue(a, 8 + row) * matrixValue(b, column * 4 + 2) +
        matrixValue(a, 12 + row) * matrixValue(b, column * 4 + 3);
    }
  }

  return out;
};

const createShader = (
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  label: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error(`Failed to create ${label} shader`);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`${label}: ${message}`);
  }

  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  const program = gl.createProgram();
  if (program === null) throw new Error(`Failed to create ${label} program`);

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`${label}: ${message}`);
  }

  return program;
};

const requireUniform = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new Error(`Missing virtual-texture uniform ${name}`);
  return location;
};

const createTerrainProgram = (gl: WebGL2RenderingContext): TerrainProgram => {
  const program = createProgram(gl, terrainVertexShaderSource, terrainFragmentShaderSource, 'virtual-texture terrain');

  return {
    program,
    uniforms: {
      atlasSlots: requireUniform(gl, program, 'u_atlasSlots'),
      lightDirection: requireUniform(gl, program, 'u_lightDirection'),
      pageTable: requireUniform(gl, program, 'u_pageTable'),
      pageTableSize: requireUniform(gl, program, 'u_pageTableSize'),
      physicalAtlas: requireUniform(gl, program, 'u_physicalAtlas'),
      viewProjection: requireUniform(gl, program, 'u_viewProjection'),
    },
  };
};

const createPreviewProgram = (gl: WebGL2RenderingContext): PreviewProgram => {
  const program = createProgram(gl, previewVertexShaderSource, previewFragmentShaderSource, 'virtual-texture preview');

  return {
    program,
    uniforms: {
      atlasSlots: requireUniform(gl, program, 'u_atlasSlots'),
      gridSize: requireUniform(gl, program, 'u_gridSize'),
      mode: requireUniform(gl, program, 'u_mode'),
      texture: requireUniform(gl, program, 'u_texture'),
    },
  };
};

const createFullscreenVertexArray = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): FullscreenQuad => {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  if (vao === null || buffer === null) throw new Error('Failed to create virtual-texture preview quad');

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]),
    gl.STATIC_DRAW,
  );

  const position = gl.getAttribLocation(program, 'a_position');
  if (position < 0) throw new Error('Missing virtual-texture preview quad attribute');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return { buffer, vao };
};

const createTerrainGeometry = (): {
  readonly indices: Uint16Array;
  readonly vertices: Float32Array;
} => {
  const vertexCount = (terrainSegments + 1) * (terrainSegments + 1);
  const vertices = new Float32Array(vertexCount * terrainVertexStride);
  const indices = new Uint16Array(terrainSegments * terrainSegments * 6);
  let vertexOffset = 0;

  for (let row = 0; row <= terrainSegments; row += 1) {
    const v = row / terrainSegments;
    const z = (v - 0.5) * terrainWorldSize;
    for (let column = 0; column <= terrainSegments; column += 1) {
      const u = column / terrainSegments;
      const x = (u - 0.5) * terrainWorldSize;

      vertices[vertexOffset] = x;
      vertices[vertexOffset + 1] = 0;
      vertices[vertexOffset + 2] = z;
      vertices[vertexOffset + 3] = 0;
      vertices[vertexOffset + 4] = 1;
      vertices[vertexOffset + 5] = 0;
      vertices[vertexOffset + 6] = u;
      vertices[vertexOffset + 7] = v;
      vertexOffset += terrainVertexStride;
    }
  }

  let indexOffset = 0;
  const rowStride = terrainSegments + 1;
  for (let row = 0; row < terrainSegments; row += 1) {
    for (let column = 0; column < terrainSegments; column += 1) {
      const topLeft = row * rowStride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + rowStride;
      const bottomRight = bottomLeft + 1;

      indices[indexOffset] = topLeft;
      indices[indexOffset + 1] = bottomLeft;
      indices[indexOffset + 2] = topRight;
      indices[indexOffset + 3] = topRight;
      indices[indexOffset + 4] = bottomLeft;
      indices[indexOffset + 5] = bottomRight;
      indexOffset += 6;
    }
  }

  return { indices, vertices };
};

const createTerrainMesh = (gl: WebGL2RenderingContext, program: WebGLProgram): TerrainMesh => {
  const vao = gl.createVertexArray();
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (vao === null || vertexBuffer === null || indexBuffer === null) {
    throw new Error('Failed to create virtual-texture terrain mesh');
  }

  const geometry = createTerrainGeometry();
  const position = gl.getAttribLocation(program, 'a_position');
  const normal = gl.getAttribLocation(program, 'a_normal');
  const uv = gl.getAttribLocation(program, 'a_uv');
  if (position < 0 || normal < 0 || uv < 0) throw new Error('Missing virtual-texture terrain attribute');

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

  const stride = terrainVertexStride * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(normal);
  gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);
  gl.bindVertexArray(null);

  return {
    indexBuffer,
    indexCount: geometry.indices.length,
    vao,
    vertexBuffer,
  };
};

const createPhysicalAtlasTexture = (
  gl: WebGL2RenderingContext,
  snapshot: VirtualTextureDebugSnapshot,
): PhysicalAtlasTexture => {
  const width = snapshot.cache.slotColumns * snapshot.config.paddedPageSize;
  const height = snapshot.cache.slotRows * snapshot.config.paddedPageSize;
  const texture = gl.createTexture();
  if (texture === null) throw new Error('Failed to create virtual-texture physical atlas');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    slotColumns: snapshot.cache.slotColumns,
    slotRows: snapshot.cache.slotRows,
    texture,
  };
};

const createProbePreviewTarget = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  label: string,
): ProbePreviewTarget => {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (texture === null || framebuffer === null) {
    throw new Error(`Failed to create virtual-texture ${label} probe preview`);
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error(`Virtual-texture ${label} probe preview framebuffer is incomplete`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    framebuffer,
    height,
    texture,
    width,
  };
};

const createProbePreviewTargets = (gl: WebGL2RenderingContext): ProbePreviewTargets => ({
  atlas: createProbePreviewTarget(gl, atlasProbePreviewSize, atlasProbePreviewSize, 'atlas'),
  pageTable: createProbePreviewTarget(gl, pageTableProbePreviewSize, pageTableProbePreviewSize, 'page-table'),
});

const pagesAtVirtualMip = (mip: number): readonly [number, number] => [
  Math.max(1, Math.ceil(basePageColumns / 2 ** mip)),
  Math.max(1, Math.ceil(basePageRows / 2 ** mip)),
];

const createPlanePhysicalPagePixels = (
  upload: VirtualTexturePhysicalAtlasPageUpload,
): PhysicalPagePixels => {
  const allocationStart = performance.now();
  const pixels = new Uint8Array(upload.width * upload.height * 4);
  const allocationMs = performance.now() - allocationStart;
  const fillStart = performance.now();
  createGeneratedVirtualTexturePagePixels({
    height: upload.height,
    sourcePage: upload.sourcePage,
    width: upload.width,
  }, pixels.buffer);

  return {
    allocationMs,
    fillMs: performance.now() - fillStart,
    pixels,
  };
};

const cameraFocusUv = (camera: CameraState): readonly [number, number] => [
  clamp(camera.targetX / terrainWorldSize + 0.5, 0, 1),
  clamp(camera.targetZ / terrainWorldSize + 0.5, 0, 1),
];

const rawDetailFromCameraZoom = (camera: CameraState): number => {
  const zoomedIn = 1 - (camera.distance - fullDetailCameraDistance) / (maxCameraDistance - fullDetailCameraDistance);
  return clamp(2 + clamp(zoomedIn, 0, 1) * (maxVirtualMip - 2), 0, maxVirtualMip);
};

const heldDetailFromCameraZoom = (
  camera: CameraState,
  cappedDetail: number,
  heldDetail: number | null,
): number => {
  const rawDetail = Math.min(rawDetailFromCameraZoom(camera), cappedDetail);
  let detail = heldDetail === null ? Math.round(rawDetail) : clamp(heldDetail, 0, cappedDetail);

  while (detail < cappedDetail && rawDetail >= detail + zoomDetailDeadband) detail += 1;
  while (detail > 0 && rawDetail <= detail - zoomDetailDeadband) detail -= 1;
  return clamp(detail, 0, cappedDetail);
};

const detailToMip = (detail: number): number => maxVirtualMip - clamp(Math.round(detail), 0, maxVirtualMip);

const focusPageForMip = (
  mip: number,
  focusU: number,
  focusV: number,
  heldFocus: HeldFocusPage | null,
): HeldFocusPage => {
  const [columns, rows] = pagesAtVirtualMip(mip);
  const targetX = clamp(focusU * columns - 0.5, 0, columns - 1);
  const targetY = clamp(focusV * rows - 0.5, 0, rows - 1);
  let x = heldFocus?.mip === mip ? heldFocus.x : Math.round(targetX);
  let y = heldFocus?.mip === mip ? heldFocus.y : Math.round(targetY);

  while (x < columns - 1 && targetX > x + focusPageDeadband) x += 1;
  while (x > 0 && targetX < x - focusPageDeadband) x -= 1;
  while (y < rows - 1 && targetY > y + focusPageDeadband) y += 1;
  while (y > 0 && targetY < y - focusPageDeadband) y -= 1;
  return {
    mip,
    x: clamp(x, 0, columns - 1),
    y: clamp(y, 0, rows - 1),
  };
};

const focusPagesAround = (
  focus: HeldFocusPage,
): readonly VirtualTexturePageAddress[] => {
  const [columns, rows] = pagesAtVirtualMip(focus.mip);
  const pages: VirtualTexturePageAddress[] = [];

  for (let y = focus.y - detailRequestRadius; y <= focus.y + detailRequestRadius; y += 1) {
    for (let x = focus.x - detailRequestRadius; x <= focus.x + detailRequestRadius; x += 1) {
      if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
      pages.push({ mip: focus.mip, x, y });
    }
  }

  return pages;
};

const uniquePages = (pages: readonly VirtualTexturePageAddress[]): readonly VirtualTexturePageAddress[] => {
  const byId = new Map<VirtualTexturePageId, VirtualTexturePageAddress>();
  for (const page of pages) byId.set(virtualTexturePageId(page), page);
  return [...byId.values()];
};

const parentPagesFor = (page: VirtualTexturePageAddress): readonly VirtualTexturePageAddress[] => {
  const pages: VirtualTexturePageAddress[] = [];
  for (let mip = maxVirtualMip; mip > page.mip; mip -= 1) {
    const scale = 2 ** (mip - page.mip);
    pages.push({
      mip,
      x: Math.floor(page.x / scale),
      y: Math.floor(page.y / scale),
    });
  }

  return pages;
};

const fallbackPagesFor = (pages: readonly VirtualTexturePageAddress[]): readonly VirtualTexturePageAddress[] =>
  uniquePages([rootPage, ...pages.flatMap(parentPagesFor)]);

const percentile = (values: readonly number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.ceil(sorted.length * ratio) - 1, 0, sorted.length - 1);

  return sorted[index] ?? 0;
};

const roundTiming = (value: number): number => Number(value.toFixed(2));

const recordFrameTime = (probe: VirtualTextureProbe, deltaMs: number): void => {
  if (!probe.ready) return;
  if (deltaMs <= 0) return;
  const timing = probe.performance;
  const rounded = roundTiming(deltaMs);
  timing.frameTimeSamples.push(rounded);
  if (timing.frameTimeSamples.length > frameTimeSampleLimit) {
    timing.frameTimeSamples.splice(0, timing.frameTimeSamples.length - frameTimeSampleLimit);
  }
  timing.lastFrameMs = rounded;
  timing.maxFrameMs = Math.max(0, ...timing.frameTimeSamples);
  timing.frameTimeP95Ms = roundTiming(percentile(timing.frameTimeSamples, 0.95));
  if (deltaMs > timing.slowFrameBudgetMs) timing.slowFrameCount += 1;
};

const emptyPendingVirtualTextureWork = (): PendingVirtualTextureWork => ({
  evictedPageIds: new Set<VirtualTexturePageId>(),
  fallbackPageTableUploads: [],
  heldDetail: null,
  heldFocus: null,
  initialBaseResolveCursor: 0,
  lastCameraRevision: -1,
  lastMaxResidentDetail: -1,
  lastRequestSignature: '',
  pageTableUploads: [],
  pendingReadback: null,
  pendingAtlasResidentIds: new Set<VirtualTexturePageId>(),
  pendingAtlasUploadKeys: new Set<string>(),
  physicalAtlasUploads: [],
  protectedPages: new Map<VirtualTexturePageId, ProtectedVirtualTexturePage>(),
  priorityBaseResolveIds: new Set<VirtualTexturePageId>(),
  priorityBaseResolves: [],
  priorityPageTableUploads: [],
  requestSignatureCounts: new Map<string, number>(),
  uploadedAtlasUploadKeys: new Set<string>(),
  uploadedResidentIds: new Set<VirtualTexturePageId>(),
  visiblePages: [],
});

const createTerrainVirtualTextureMaterialAdapter = (
  pageGenerator: WorkerBackedTerrainPageGenerator,
): VirtualTextureMaterialAdapter => ({
  createPagePixels: createPlanePhysicalPagePixels,
  pageGenerator,
  planRequests: ({ camera, heldDetail, heldFocus, maxResidentDetail }) => {
    const [focusU, focusV] = cameraFocusUv(camera);
    const cappedDetail = clamp(Math.round(maxResidentDetail), 0, maxVirtualMip);
    const requestedDetail = heldDetailFromCameraZoom(camera, cappedDetail, heldDetail);
    const requestedMip = detailToMip(requestedDetail);
    const focusPage = focusPageForMip(requestedMip, focusU, focusV, heldFocus);
    const focusPages = focusPagesAround(focusPage);
    const fallbackPages = fallbackPagesFor(focusPages);
    const pagesToMakeResident = uniquePages([
      ...fallbackPages,
      ...focusPages,
    ]);
    const requestedPageIds = pagesToMakeResident.map(virtualTexturePageId);

    return {
      basePagesToResolve: focusPages,
      detail: {
        baseResolveCount: 0,
        effectiveVirtualResolution: pageSize * 2 ** requestedDetail,
        focusU: Number(focusU.toFixed(3)),
        focusV: Number(focusV.toFixed(3)),
        maxResidentDetail: cappedDetail,
        maxResidentMip: detailToMip(cappedDetail),
        requestSignature: requestedPageIds.join('|'),
        requestedMip,
        requestedPageIds,
        requestedPages: pagesToMakeResident.length,
      },
      fallbackPagesToMakeResident: fallbackPages,
      heldDetail: requestedDetail,
      heldFocus: focusPage,
      pagesToMakeResident,
      visiblePagesToMakeResident: focusPages,
    };
  },
});

const resizeCanvas = (canvas: HTMLCanvasElement): readonly [number, number] => {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * scale));
  const height = Math.max(1, Math.floor(rect.height * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return [width, height];
};

const readTextureLevel = (
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  pageTable: VirtualTexturePageTableTexture,
): PageTableReadback => {
  const mip = pageTable.mipDimensions[0];
  if (mip === undefined) throw new Error('Virtual texture page table is missing base level');

  const pixels = new Uint8Array(mip.width * mip.height * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pageTable.texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, mip.width, mip.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readBuffer(gl.BACK);

  const entries = new Set<string>();
  let nonZeroTexels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const entry = `${pixels[index] ?? 0}:${pixels[index + 1] ?? 0}:${pixels[index + 2] ?? 0}:${pixels[index + 3] ?? 0}`;
    entries.add(entry);
    if ((pixels[index + 3] ?? 0) !== 0) nonZeroTexels += 1;
  }

  return {
    nonZeroTexels,
    texels: mip.width * mip.height,
    uniqueEntries: entries.size,
  };
};

const readBoundFramebufferRegion = (
  gl: WebGL2RenderingContext,
  boundsWidth: number,
  boundsHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasReadback => {
  const left = clamp(Math.floor(x), 0, Math.max(0, boundsWidth - 1));
  const bottom = clamp(Math.floor(y), 0, Math.max(0, boundsHeight - 1));
  const regionWidth = Math.max(1, Math.min(Math.floor(width), boundsWidth - left));
  const regionHeight = Math.max(1, Math.min(Math.floor(height), boundsHeight - bottom));
  const sampleColumns = Math.max(1, Math.min(4, regionWidth));
  const sampleRows = Math.max(1, Math.min(4, regionHeight));
  const sampleWidth = Math.max(1, Math.min(24, Math.floor(regionWidth / sampleColumns)));
  const sampleHeight = Math.max(1, Math.min(24, Math.floor(regionHeight / sampleRows)));
  const maxX = left + regionWidth - sampleWidth;
  const maxY = bottom + regionHeight - sampleHeight;
  const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);

  const buckets = new Set<string>();
  let painted = 0;
  let texels = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const readY = sampleRows === 1 ? bottom : Math.round(bottom + ((maxY - bottom) * row) / (sampleRows - 1));
    for (let column = 0; column < sampleColumns; column += 1) {
      const readX = sampleColumns === 1 ? left : Math.round(left + ((maxX - left) * column) / (sampleColumns - 1));
      gl.readPixels(readX, readY, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      texels += sampleWidth * sampleHeight;

      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        if (alpha !== 0) painted += 1;
        buckets.add(`${red >> 5}:${green >> 5}:${blue >> 5}:${alpha >> 6}`);
      }
    }
  }

  return {
    colorBuckets: buckets.size,
    paintedRatio: painted / Math.max(1, texels),
  };
};

const readCanvasRegion = (
  gl: WebGL2RenderingContext,
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasReadback => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readBuffer(gl.BACK);
  return readBoundFramebufferRegion(gl, gl.drawingBufferWidth, gl.drawingBufferHeight, x, y, width, height);
};

const readCanvas = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): CanvasReadback => readCanvasRegion(gl, 0, 0, width, height);

const readProbePreviewTarget = (
  gl: WebGL2RenderingContext,
  target: ProbePreviewTarget,
): CanvasReadback => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  const readback = readBoundFramebufferRegion(gl, target.width, target.height, 0, 0, target.width, target.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readBuffer(gl.BACK);
  return readback;
};

const cameraProbe = (state: CameraState): CameraProbe => ({
  distance: Number(state.distance.toFixed(3)),
  inputEvents: state.inputEvents,
  interactionActive: state.interactionActive,
  lastInteractionAgoMs: state.lastInteractionTime === 0
    ? 0
    : Math.max(0, Math.round(performance.now() - state.lastInteractionTime)),
  moved: state.moved,
  pitch: Number(state.pitch.toFixed(3)),
  revision: state.revision,
  targetX: Number(state.targetX.toFixed(3)),
  targetZ: Number(state.targetZ.toFixed(3)),
  yaw: Number(state.yaw.toFixed(3)),
});

const updateProbeFromRuntimeStats = (
  probe: VirtualTextureProbe,
  stats: VirtualTextureRuntimeStats,
  residentIds: readonly VirtualTexturePageId[],
  pageTableReadback: PageTableReadback,
  canvasReadback: CanvasReadback,
): void => {
  const exactPageCount = stats.pageTable.exact;
  const fallbackPageCount = stats.pageTable.fallback;
  const terrainReady = probe.terrainDrawCalls > 0 &&
    probe.terrainReadback.colorBuckets >= 6 &&
    probe.terrainReadback.paintedRatio >= 0.2;
  const previewReady = probe.previewDrawCalls >= 2 &&
    probe.atlasPreviewReadback.colorBuckets >= 4 &&
    probe.atlasPreviewReadback.paintedRatio >= 0.2 &&
    probe.pageTablePreviewReadback.colorBuckets >= 3 &&
    probe.pageTablePreviewReadback.paintedRatio >= 0.2;
  const detailReady = probe.detail.baseResolveCount >= basePages.length &&
    probe.detail.effectiveVirtualResolution >= pageSize &&
    probe.detail.requestedPages >= 1;
  const uploadReady = probe.pageTableTexelUploads >= basePages.length &&
    probe.physicalAtlasUploads >= 2;
  const readbackReady = pageTableReadback.nonZeroTexels >= basePages.length &&
    canvasReadback.colorBuckets >= 6 &&
    terrainReady &&
    previewReady;
  const drainedReady = probe.performance.pendingPages === 0 &&
    probe.drawCalls >= 6 &&
    probe.terrainDrawCalls >= 2 &&
    probe.previewDrawCalls >= 4;

  probe.canvasReadback = canvasReadback;
  probe.exactPageCount = exactPageCount;
  probe.fallbackPageCount = fallbackPageCount;
  probe.pageTableReadback = pageTableReadback;
  probe.ready = probe.ready || (
    probe.supported &&
    probe.frameCount >= 2 &&
    uploadReady &&
    fallbackPageCount > 0 &&
    detailReady &&
    (readbackReady || drainedReady)
  );
  probe.residentPageIds = residentIds;
};

const atlasUploadKey = (upload: VirtualTexturePhysicalAtlasPageUpload): string =>
  `${upload.residentPageId}:${upload.uploadSerial}`;

const pageKey = (page: VirtualTexturePageAddress): VirtualTexturePageId => virtualTexturePageId(page);

const rgba8Equals = (
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean =>
  left[0] === right[0] &&
  left[1] === right[1] &&
  left[2] === right[2] &&
  left[3] === right[3];

const isZeroRgba8 = (rgba8: readonly [number, number, number, number]): boolean =>
  rgba8[0] === 0 && rgba8[1] === 0 && rgba8[2] === 0 && rgba8[3] === 0;

const queuePageTableUploads = (
  dirtyEntries: ReturnType<VirtualTextureRuntime['drainDirtyEntries']>,
  uploads: readonly VirtualTexturePageTableTexelUpload[],
  frame: number,
  priority: QueuedWorkPriority,
  requestSignature: string,
): readonly QueuedPageTableUpload[] => {
  const uploadSerialsByDirtyEntry = new Map<string, number | null>();
  for (const dirty of dirtyEntries) {
    uploadSerialsByDirtyEntry.set(
      `${dirty.sequence}:${pageKey(dirty.tableCoord)}`,
      dirty.entry.uploadSerial,
    );
  }

  return uploads.map((upload) => ({
    priority,
    queuedFrame: frame,
    requestSignature,
    upload,
    uploadSerial: uploadSerialsByDirtyEntry.get(`${upload.dirtySequence}:${pageKey(upload.tableCoord)}`) ?? null,
  }));
};

const isPhysicalAtlasUploadCurrent = (
  runtime: VirtualTextureRuntime,
  upload: VirtualTexturePhysicalAtlasPageUpload,
): boolean => {
  const resident = runtime.lookupResidentPage(upload.residentPageId);
  if (resident === null) return false;

  const slot = runtime.lookupSlot(upload.slot.slot);

  return resident.slot === upload.slot.slot &&
    resident.mip === upload.sourcePage.mip &&
    resident.x === upload.sourcePage.x &&
    resident.y === upload.sourcePage.y &&
    resident.uploadSerial === upload.uploadSerial &&
    slot.pageId === upload.residentPageId &&
    slot.uploadSerial === upload.uploadSerial &&
    slot.status === 'resident';
};

const isPageTableUploadCurrent = (
  runtime: VirtualTextureRuntime,
  queued: QueuedPageTableUpload,
): boolean => {
  const { upload } = queued;
  const currentEntry = runtime.lookupPageTableEntry(upload.tableCoord);
  if (currentEntry === null) return upload.residentPageId === null && isZeroRgba8(upload.rgba8);
  if (currentEntry.residentPageId !== upload.residentPageId) return false;
  if (currentEntry.uploadSerial !== queued.uploadSerial) return false;
  if (!rgba8Equals(currentEntry.encodedRgba8, upload.rgba8)) return false;
  if (currentEntry.physicalSlot === null) return upload.residentPageId === null;
  if (currentEntry.residentPageId === null) return false;

  const resident = runtime.lookupResidentPage(currentEntry.residentPageId);
  if (resident === null) return false;
  if (resident.slot !== currentEntry.physicalSlot.slot) return false;
  if (resident.uploadSerial !== currentEntry.uploadSerial) return false;

  const slot = runtime.lookupSlot(currentEntry.physicalSlot.slot);
  return slot.pageId === currentEntry.residentPageId &&
    slot.uploadSerial === currentEntry.uploadSerial &&
    slot.status === 'resident';
};

const rebuildPendingAtlasUploadIndexes = (work: PendingVirtualTextureWork): void => {
  work.pendingAtlasResidentIds.clear();
  work.pendingAtlasUploadKeys.clear();
  for (const { upload } of work.physicalAtlasUploads) {
    work.pendingAtlasResidentIds.add(upload.residentPageId);
    work.pendingAtlasUploadKeys.add(atlasUploadKey(upload));
  }
};

const recordStaleDrops = (
  probe: VirtualTextureProbe,
  atlasDrops: number,
  pageTableDrops: number,
): void => {
  if (atlasDrops === 0 && pageTableDrops === 0) return;
  const timing = probe.performance;
  timing.staleAtlasUploadDrops += atlasDrops;
  timing.stalePageTableUploadDrops += pageTableDrops;
  timing.staleQueuedDrops += atlasDrops + pageTableDrops;
  timing.repeatedDropCount += atlasDrops + pageTableDrops;
};

const pruneStaleQueuedUploads = (
  runtime: VirtualTextureRuntime,
  work: PendingVirtualTextureWork,
  probe: VirtualTextureProbe,
): void => {
  const previousAtlasUploads = work.physicalAtlasUploads.length;
  work.physicalAtlasUploads = work.physicalAtlasUploads.filter((queued) =>
    isPhysicalAtlasUploadCurrent(runtime, queued.upload)
  );
  rebuildPendingAtlasUploadIndexes(work);
  const previousPriorityUploads = work.priorityPageTableUploads.length;
  const previousFallbackUploads = work.fallbackPageTableUploads.length;
  const previousBackgroundUploads = work.pageTableUploads.length;
  work.priorityPageTableUploads = work.priorityPageTableUploads.filter((queued) =>
    isPageTableUploadCurrent(runtime, queued)
  );
  work.fallbackPageTableUploads = work.fallbackPageTableUploads.filter((queued) =>
    isPageTableUploadCurrent(runtime, queued)
  );
  work.pageTableUploads = work.pageTableUploads.filter((queued) =>
    isPageTableUploadCurrent(runtime, queued)
  );
  recordStaleDrops(
    probe,
    previousAtlasUploads - work.physicalAtlasUploads.length,
    previousPriorityUploads +
      previousFallbackUploads +
      previousBackgroundUploads -
      work.priorityPageTableUploads.length -
      work.fallbackPageTableUploads.length -
      work.pageTableUploads.length,
  );
};

const queuedInteractiveWorkPages = (work: PendingVirtualTextureWork): number =>
  work.priorityBaseResolves.length +
  work.physicalAtlasUploads.length +
  work.priorityPageTableUploads.length +
  work.fallbackPageTableUploads.length;

const canResolveBackgroundBasePages = (work: PendingVirtualTextureWork): boolean =>
  queuedInteractiveWorkPages(work) <= maxInteractiveWorkBeforeBackground &&
  work.pageTableUploads.length < maxBackgroundPageTableBacklog;

const enqueuePageTableUploads = (
  work: PendingVirtualTextureWork,
  uploads: readonly QueuedPageTableUpload[],
  priority: QueuedWorkPriority,
): void => {
  if (uploads.length === 0) return;
  if (priority === 'visible') work.priorityPageTableUploads.push(...uploads);
  else if (priority === 'fallback') work.fallbackPageTableUploads.push(...uploads);
  else work.pageTableUploads.push(...uploads);
};

const enqueuePhysicalAtlasUploads = (
  work: PendingVirtualTextureWork,
  uploads: readonly VirtualTexturePhysicalAtlasPageUpload[],
  frame: number,
  priority: QueuedWorkPriority,
  requestSignature: string,
  probe: VirtualTextureProbe,
): void => {
  for (const upload of uploads) {
    const key = atlasUploadKey(upload);
    if (work.uploadedAtlasUploadKeys.has(key) || work.pendingAtlasUploadKeys.has(key)) continue;
    if (work.uploadedResidentIds.has(upload.residentPageId)) {
      probe.performance.uploadChurnCount += 1;
      probe.performance.uploadThrashCount = probe.performance.uploadChurnCount;
    }
    work.pendingAtlasUploadKeys.add(key);
    work.pendingAtlasResidentIds.add(upload.residentPageId);
    work.physicalAtlasUploads.push({
      priority,
      queuedFrame: frame,
      requestSignature,
      upload,
    });
  }
};

const enqueueRuntimeUploads = (
  runtime: VirtualTextureRuntime,
  frame: number,
  work: PendingVirtualTextureWork,
  priority: QueuedWorkPriority,
  requestSignature: string,
  probe: VirtualTextureProbe,
): void => {
  const dirtyEntries = runtime.drainDirtyEntries(frame);
  if (dirtyEntries.length === 0) return;
  const plan = planVirtualTextureUploads(dirtyEntries, { pageSize });
  enqueuePageTableUploads(
    work,
    queuePageTableUploads(dirtyEntries, plan.pageTableUploads, frame, priority, requestSignature),
    priority,
  );
  enqueuePhysicalAtlasUploads(work, plan.physicalAtlasUploads, frame, priority, requestSignature, probe);
};

const physicalAtlasUploadPriority = (queued: QueuedPhysicalAtlasUpload): number => {
  if (pageKey(queued.upload.sourcePage) === pageKey(rootPage)) return 0;
  if (queued.priority === 'visible') return 1;
  if (queued.priority === 'fallback') return 2;
  return 3;
};

const compareQueuedPhysicalAtlasUploads = (
  left: QueuedPhysicalAtlasUpload,
  right: QueuedPhysicalAtlasUpload,
): number =>
  physicalAtlasUploadPriority(left) - physicalAtlasUploadPriority(right) ||
  left.upload.sourcePage.mip - right.upload.sourcePage.mip ||
  left.queuedFrame - right.queuedFrame ||
  left.upload.uploadSerial - right.upload.uploadSerial;

const enqueuePriorityBaseResolves = (
  work: PendingVirtualTextureWork,
  pages: readonly VirtualTexturePageAddress[],
): void => {
  for (const page of pages) {
    const id = virtualTexturePageId(page);
    if (work.priorityBaseResolveIds.has(id)) continue;
    work.priorityBaseResolveIds.add(id);
    work.priorityBaseResolves.push(page);
  }
};

const uploadPhysicalAtlasPageBatch = (
  gl: WebGL2RenderingContext,
  atlas: PhysicalAtlasTexture,
  uploads: readonly PreparedTerrainPageUpload[],
  probe: VirtualTextureProbe,
  material: VirtualTextureMaterialAdapter,
): PhysicalAtlasUploadStats => {
  let allocationMs = 0;
  let bytesUploaded = 0;
  let fillMs = 0;
  let generationMs = 0;
  let uploadMs = 0;
  let workerLatencyMs = 0;

  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  for (const prepared of uploads) {
    const { upload } = prepared;
    generationMs += prepared.generationMs;
    allocationMs += prepared.allocationMs;
    fillMs += prepared.fillMs;
    workerLatencyMs += prepared.workerLatencyMs;

    const uploadStart = performance.now();
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      upload.level,
      upload.xOffset,
      upload.yOffset,
      upload.width,
      upload.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      prepared.pixels,
    );
    material.pageGenerator.release(prepared);
    uploadMs += performance.now() - uploadStart;
    bytesUploaded += upload.byteLength;
    probe.bytesUploaded += upload.byteLength;
    probe.lastPhysicalAtlasUpload = upload.residentPageId;
    probe.physicalAtlasUploads += 1;
  }

  return {
    allocationMs: roundTiming(allocationMs),
    bytesUploaded,
    fillMs: roundTiming(fillMs),
    generationMs: roundTiming(generationMs),
    pagesUploaded: uploads.length,
    uploadMs: roundTiming(uploadMs),
    workerLatencyMs: roundTiming(workerLatencyMs),
  };
};

const takePhysicalAtlasUploadBatch = (
  work: PendingVirtualTextureWork,
): readonly VirtualTexturePhysicalAtlasPageUpload[] =>
  work.physicalAtlasUploads.splice(0, maxPhysicalAtlasUploadsPerChunk).map((queued) => queued.upload);

const prepareSynchronousAtlasUpload = (
  material: VirtualTextureMaterialAdapter,
  upload: VirtualTexturePhysicalAtlasPageUpload,
): PreparedTerrainPageUpload => {
  const generationStart = performance.now();
  const pagePixels = material.createPagePixels(upload);

  return {
    allocationMs: pagePixels.allocationMs,
    fillMs: pagePixels.fillMs,
    generationMs: performance.now() - generationStart,
    pixels: pagePixels.pixels,
    upload,
    workerLatencyMs: 0,
  };
};

const removePreparedAtlasUploads = (
  work: PendingVirtualTextureWork,
  preparedUploads: readonly PreparedTerrainPageUpload[],
): void => {
  if (preparedUploads.length === 0) return;
  const uploadedKeys = new Set(preparedUploads.map((prepared) => atlasUploadKey(prepared.upload)));
  work.physicalAtlasUploads = work.physicalAtlasUploads.filter((queued) =>
    !uploadedKeys.has(atlasUploadKey(queued.upload))
  );
};

const preparePhysicalAtlasUploadBatch = (
  runtime: VirtualTextureRuntime,
  work: PendingVirtualTextureWork,
  material: VirtualTextureMaterialAdapter,
): readonly PreparedTerrainPageUpload[] => {
  const workerMetrics = material.pageGenerator.metrics();
  work.physicalAtlasUploads.sort(compareQueuedPhysicalAtlasUploads);
  if (!workerMetrics.available) {
    return takePhysicalAtlasUploadBatch(work).map((upload) => prepareSynchronousAtlasUpload(material, upload));
  }

  const isCurrent = (upload: VirtualTexturePhysicalAtlasPageUpload): boolean =>
    isPhysicalAtlasUploadCurrent(runtime, upload);
  material.pageGenerator.dropStale(isCurrent);
  let requestedUploads = 0;
  for (const queued of work.physicalAtlasUploads) {
    if (workerMetrics.queueDepth + requestedUploads >= maxWorkerQueuedAtlasUploads) break;
    if (!material.pageGenerator.request(queued.upload)) break;
    requestedUploads += 1;
  }

  const preparedUploads = material.pageGenerator.takeReady(
    work.physicalAtlasUploads.map((queued) => queued.upload),
    maxPhysicalAtlasUploadsPerChunk,
    isCurrent,
  );
  removePreparedAtlasUploads(work, preparedUploads);
  return preparedUploads;
};

const clearPendingAtlasUpload = (
  work: PendingVirtualTextureWork,
  upload: VirtualTexturePhysicalAtlasPageUpload,
): void => {
  work.pendingAtlasUploadKeys.delete(atlasUploadKey(upload));
  work.uploadedAtlasUploadKeys.add(atlasUploadKey(upload));
  work.uploadedResidentIds.add(upload.residentPageId);
  const hasPendingForResident = work.physicalAtlasUploads.some(
    (pending) => pending.upload.residentPageId === upload.residentPageId,
  );
  if (!hasPendingForResident) work.pendingAtlasResidentIds.delete(upload.residentPageId);
};

const takePageTableUploadBatch = (
  work: PendingVirtualTextureWork,
): readonly VirtualTexturePageTableTexelUpload[] => {
  const batch: QueuedPageTableUpload[] = [];
  const takeFrom = (queue: QueuedPageTableUpload[]): void => {
    if (batch.length >= maxPageTableTexelUploadsPerChunk) return;
    const remaining: QueuedPageTableUpload[] = [];
    for (const queued of queue) {
      const blocked = queued.upload.residentPageId !== null &&
        work.pendingAtlasResidentIds.has(queued.upload.residentPageId);
      if (!blocked && batch.length < maxPageTableTexelUploadsPerChunk) batch.push(queued);
      else remaining.push(queued);
    }
    queue.length = 0;
    queue.push(...remaining);
  };

  takeFrom(work.priorityPageTableUploads);
  takeFrom(work.fallbackPageTableUploads);
  takeFrom(work.pageTableUploads);
  return batch.map((queued) => queued.upload);
};

const pendingWorkPages = (work: PendingVirtualTextureWork): number =>
  work.priorityBaseResolves.length +
  work.physicalAtlasUploads.length +
  work.priorityPageTableUploads.length +
  work.fallbackPageTableUploads.length +
  work.pageTableUploads.length;

const oldestQueuedWorkFrames = (work: PendingVirtualTextureWork, frame: number): number => {
  let oldest = 0;
  const visitPageTableQueue = (queue: readonly QueuedPageTableUpload[]): void => {
    for (const queued of queue) oldest = Math.max(oldest, frame - queued.queuedFrame);
  };

  for (const queued of work.physicalAtlasUploads) oldest = Math.max(oldest, frame - queued.queuedFrame);
  visitPageTableQueue(work.priorityPageTableUploads);
  visitPageTableQueue(work.fallbackPageTableUploads);
  visitPageTableQueue(work.pageTableUploads);
  return oldest;
};

const hasPendingVirtualTextureWork = (work: PendingVirtualTextureWork): boolean =>
  pendingWorkPages(work) > 0 ||
  work.initialBaseResolveCursor < basePages.length ||
  work.pendingReadback !== null;

const queueProbeReadback = (
  work: PendingVirtualTextureWork,
  request: VirtualTextureReadbackRequest,
): void => {
  work.pendingReadback = request;
};

const resetLastPerformanceTick = (probe: VirtualTextureProbe): void => {
  const timing = probe.performance;
  timing.lastAdvanceMs = 0;
  timing.lastAllocationMs = 0;
  timing.lastAtlasUploadCount = 0;
  timing.lastFillMs = 0;
  timing.lastPageGenerationMs = 0;
  timing.lastPlanMs = 0;
  timing.lastPageTableUploadCount = 0;
  timing.lastPageTableUploadMs = 0;
  timing.lastResolvedBasePages = 0;
  timing.lastTextureUploadMs = 0;
  timing.lastWorkerGenerationLatencyMs = 0;
  timing.pendingPages = 0;
};

const recordAdvancePerformance = (
  probe: VirtualTextureProbe,
  elapsedMs: number,
  atlasStats: PhysicalAtlasUploadStats,
  material: VirtualTextureMaterialAdapter,
  planMs: number,
  pageTableUploadCount: number,
  pageTableUploadMs: number,
  resolvedBasePages: number,
  work: PendingVirtualTextureWork,
): void => {
  const timing = probe.performance;
  const roundedAdvance = roundTiming(elapsedMs);
  timing.advanceCount += 1;
  timing.lastAdvanceMs = roundedAdvance;
  timing.lastAllocationMs = atlasStats.allocationMs;
  timing.lastAtlasUploadCount = atlasStats.pagesUploaded;
  timing.lastFillMs = atlasStats.fillMs;
  timing.lastPageGenerationMs = atlasStats.generationMs;
  timing.lastPlanMs = roundTiming(planMs);
  timing.lastPageTableUploadCount = pageTableUploadCount;
  timing.lastPageTableUploadMs = roundTiming(pageTableUploadMs);
  timing.lastResolvedBasePages = resolvedBasePages;
  timing.lastTextureUploadMs = atlasStats.uploadMs;
  timing.lastWorkerGenerationLatencyMs = atlasStats.workerLatencyMs;
  timing.maxAdvanceMs = Math.max(timing.maxAdvanceMs, roundedAdvance);
  timing.maxAllocationMs = Math.max(timing.maxAllocationMs, atlasStats.allocationMs);
  timing.maxFillMs = Math.max(timing.maxFillMs, atlasStats.fillMs);
  timing.maxPageGenerationMs = Math.max(timing.maxPageGenerationMs, atlasStats.generationMs);
  timing.maxPlanMs = Math.max(timing.maxPlanMs, timing.lastPlanMs);
  timing.maxPageTableUploadMs = Math.max(timing.maxPageTableUploadMs, timing.lastPageTableUploadMs);
  timing.maxTextureUploadMs = Math.max(timing.maxTextureUploadMs, atlasStats.uploadMs);
  timing.maxWorkerGenerationLatencyMs = Math.max(
    timing.maxWorkerGenerationLatencyMs,
    timing.lastWorkerGenerationLatencyMs,
  );
  timing.cacheChurnCount = timing.evictionCount;
  timing.cacheThrashCount = timing.cacheChurnCount;
  timing.cacheChurnRatio = roundTiming(timing.evictionCount / Math.max(1, timing.advanceCount));
  timing.oldestQueuedWorkFrames = oldestQueuedWorkFrames(work, probe.frameCount);
  timing.pendingPages = pendingWorkPages(work);
  timing.pendingReadbacks = work.pendingReadback === null ? 0 : 1;
  timing.protectedPages = work.protectedPages.size;
  timing.uploadChurnRatio = roundTiming(timing.uploadChurnCount / Math.max(1, probe.physicalAtlasUploads));

  const workerMetrics = material.pageGenerator.metrics();
  timing.buffersAllocated = workerMetrics.buffersAllocated;
  timing.buffersReused = workerMetrics.buffersReused;
  timing.inFlightBytes = workerMetrics.inFlightBytes;
  timing.queueDepth = workerMetrics.queueDepth;
  timing.staleDrops = workerMetrics.staleDrops;
  timing.workerAvailable = workerMetrics.available;
  timing.workerCount = workerMetrics.workerCount;
  timing.workerFallbackPages = workerMetrics.fallbackPages;
  timing.workerGeneratedPages = workerMetrics.completedPages;
  timing.workerLastError = workerMetrics.lastError;
  timing.maxWorkerGenerationLatencyMs = Math.max(
    timing.maxWorkerGenerationLatencyMs,
    workerMetrics.maxWorkerGenerationLatencyMs,
  );
};

const recordEviction = (
  probe: VirtualTextureProbe,
  work: PendingVirtualTextureWork,
  evictedId: VirtualTexturePageId,
): void => {
  work.evictedPageIds.add(evictedId);
  probe.performance.evictionCount += 1;
  if (work.protectedPages.has(evictedId)) probe.performance.protectedPageEvictions += 1;
};

const rememberProtectedPages = (
  work: PendingVirtualTextureWork,
  pages: readonly VirtualTexturePageAddress[],
  frame: number,
): void => {
  for (const page of pages) {
    const id = virtualTexturePageId(page);
    const protectedPage = work.protectedPages.get(id);
    if (protectedPage === undefined) {
      work.protectedPages.set(id, { page, lastRequestedFrame: frame });
    } else {
      protectedPage.lastRequestedFrame = frame;
    }
  }

  for (const [id, protectedPage] of work.protectedPages) {
    if (frame - protectedPage.lastRequestedFrame > protectedPageHoldFrames) work.protectedPages.delete(id);
  }

  if (work.protectedPages.size <= maxProtectedPages) return;
  const oldest = [...work.protectedPages.entries()]
    .sort((a, b) => a[1].lastRequestedFrame - b[1].lastRequestedFrame)
    .slice(0, work.protectedPages.size - maxProtectedPages);
  for (const [id] of oldest) work.protectedPages.delete(id);
};

const touchProtectedResidentPages = (
  runtime: VirtualTextureRuntime,
  work: PendingVirtualTextureWork,
  frame: number,
): void => {
  for (const [id, protectedPage] of work.protectedPages) {
    if (runtime.lookupResidentPage(id) !== null) runtime.makeResident(protectedPage.page, frame);
  }
};

const requestPlanPageIds = (requestPlan: VirtualTextureMaterialRequestPlan): ReadonlySet<VirtualTexturePageId> =>
  new Set(requestPlan.pagesToMakeResident.map(virtualTexturePageId));

const dropQueuedWorkForSignatureChange = (
  work: PendingVirtualTextureWork,
  requestPlan: VirtualTextureMaterialRequestPlan,
  previousSignature: string,
  probe: VirtualTextureProbe,
): void => {
  if (previousSignature === '' || previousSignature === requestPlan.detail.requestSignature) return;
  const requestedIds = requestPlanPageIds(requestPlan);
  const keepResidentId = (id: VirtualTexturePageId | null): boolean =>
    id !== null && (requestedIds.has(id) || work.protectedPages.has(id));
  const keepPageTableUpload = (queued: QueuedPageTableUpload): boolean =>
    queued.requestSignature === requestPlan.detail.requestSignature ||
    keepResidentId(queued.upload.residentPageId);
  const keepAtlasUpload = (queued: QueuedPhysicalAtlasUpload): boolean =>
    queued.requestSignature === requestPlan.detail.requestSignature ||
    requestedIds.has(queued.upload.residentPageId) ||
    work.protectedPages.has(queued.upload.residentPageId);
  const atlasBefore = work.physicalAtlasUploads.length;
  const priorityBefore = work.priorityPageTableUploads.length;
  const fallbackBefore = work.fallbackPageTableUploads.length;
  const backgroundBefore = work.pageTableUploads.length;

  work.physicalAtlasUploads = work.physicalAtlasUploads.filter(keepAtlasUpload);
  work.priorityPageTableUploads = work.priorityPageTableUploads.filter(keepPageTableUpload);
  work.fallbackPageTableUploads = work.fallbackPageTableUploads.filter(keepPageTableUpload);
  work.pageTableUploads = work.pageTableUploads.filter(keepPageTableUpload);
  rebuildPendingAtlasUploadIndexes(work);
  recordStaleDrops(
    probe,
    atlasBefore - work.physicalAtlasUploads.length,
    priorityBefore +
      fallbackBefore +
      backgroundBefore -
      work.priorityPageTableUploads.length -
      work.fallbackPageTableUploads.length -
      work.pageTableUploads.length,
  );

  const baseBefore = work.priorityBaseResolves.length;
  work.priorityBaseResolves = work.priorityBaseResolves.filter((page) =>
    requestPlan.basePagesToResolve.some((nextPage) => pageKey(nextPage) === pageKey(page))
  );
  work.priorityBaseResolveIds.clear();
  for (const page of work.priorityBaseResolves) work.priorityBaseResolveIds.add(pageKey(page));
  probe.performance.staleQueuedDrops += baseBefore - work.priorityBaseResolves.length;
};

const updateQualityProbe = (
  runtime: VirtualTextureRuntime,
  probe: VirtualTextureProbe,
  work: PendingVirtualTextureWork,
): void => {
  let exactHits = 0;
  for (const page of work.visiblePages) {
    const entry = runtime.lookupPageTableEntry(page);
    if (entry?.mipDelta === 0 && entry.residentPageId === pageKey(page)) exactHits += 1;
  }

  const timing = probe.performance;
  timing.exactHitRatio = work.visiblePages.length === 0
    ? 1
    : roundTiming(exactHits / work.visiblePages.length);
  timing.fullPageTableRebuildsAfterInit = 0;
  timing.recentEvictionReRequestRatio = timing.cacheChurnRatio;
  timing.repeatedReloadRatio = roundTiming(timing.uploadChurnCount / Math.max(1, probe.physicalAtlasUploads));
};

const serviceVirtualTextureRuntime = (
  runtime: VirtualTextureRuntime,
  gl: WebGL2RenderingContext,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  material: VirtualTextureMaterialAdapter,
  settings: VirtualTextureDemoSettings,
  camera: CameraState,
  probe: VirtualTextureProbe,
  work: PendingVirtualTextureWork,
  chunkBudgetMs: number,
): boolean => {
  const started = performance.now();
  const hasBudget = (): boolean => performance.now() - started < chunkBudgetMs;
  const frame = probe.frameCount;
  let planMs = 0;
  let resolvedBasePages = 0;
  resetLastPerformanceTick(probe);

  const shouldPlanRequest = work.lastRequestSignature === '' ||
    work.lastCameraRevision !== camera.revision ||
    work.lastMaxResidentDetail !== settings.maxResidentDetail;
  if (shouldPlanRequest) {
    const planStart = performance.now();
    const requestPlan = material.planRequests({
      camera,
      frame,
      heldDetail: work.heldDetail,
      heldFocus: work.heldFocus,
      maxResidentDetail: settings.maxResidentDetail,
    });
    const previousSignature = work.lastRequestSignature;
    const requestSignature = requestPlan.detail.requestSignature;
    const signatureSeen = work.requestSignatureCounts.get(requestSignature) ?? 0;
    if (previousSignature === requestSignature || signatureSeen > 0) probe.performance.repeatedRequestCount += 1;

    dropQueuedWorkForSignatureChange(work, requestPlan, previousSignature, probe);
    rememberProtectedPages(work, requestPlan.pagesToMakeResident, frame);
    touchProtectedResidentPages(runtime, work, frame);

    for (const page of requestPlan.fallbackPagesToMakeResident) {
      const result = runtime.makeResident(page, frame);
      if (result.evicted !== null) recordEviction(probe, work, result.evicted.id);
    }
    enqueueRuntimeUploads(runtime, frame, work, 'fallback', requestSignature, probe);

    for (const page of requestPlan.visiblePagesToMakeResident) {
      const result = runtime.makeResident(page, frame);
      if (result.evicted !== null) recordEviction(probe, work, result.evicted.id);
    }
    enqueueRuntimeUploads(runtime, frame, work, 'visible', requestSignature, probe);

    enqueuePriorityBaseResolves(work, requestPlan.basePagesToResolve);

    work.heldDetail = requestPlan.heldDetail;
    work.heldFocus = requestPlan.heldFocus;
    work.lastCameraRevision = camera.revision;
    work.lastMaxResidentDetail = settings.maxResidentDetail;
    work.lastRequestSignature = requestSignature;
    work.requestSignatureCounts.set(requestSignature, signatureSeen + 1);
    work.visiblePages = [...requestPlan.visiblePagesToMakeResident];
    probe.detail = {
      ...requestPlan.detail,
      baseResolveCount: work.initialBaseResolveCursor,
    };
    planMs = performance.now() - planStart;
  }

  let resolveBudget = maxBaseResolvesPerChunk;
  while (hasBudget() && resolveBudget > 0 && work.priorityBaseResolves.length > 0) {
    const page = work.priorityBaseResolves.shift();
    if (page === undefined) break;
    work.priorityBaseResolveIds.delete(virtualTexturePageId(page));
    runtime.resolve(page, frame);
    resolveBudget -= 1;
    resolvedBasePages += 1;
  }
  enqueueRuntimeUploads(runtime, frame, work, 'visible', work.lastRequestSignature, probe);

  while (
    hasBudget() &&
    resolveBudget > 0 &&
    work.initialBaseResolveCursor < basePages.length &&
    canResolveBackgroundBasePages(work)
  ) {
    const page = basePages[work.initialBaseResolveCursor];
    work.initialBaseResolveCursor += 1;
    if (page === undefined) continue;
    runtime.resolve(page, frame);
    resolveBudget -= 1;
    resolvedBasePages += 1;
    if (resolvedBasePages > 0 && resolvedBasePages % maxBackgroundPageTableBacklog === 0) {
      enqueueRuntimeUploads(runtime, frame, work, 'background', work.lastRequestSignature, probe);
    }
  }
  enqueueRuntimeUploads(runtime, frame, work, 'background', work.lastRequestSignature, probe);

  pruneStaleQueuedUploads(runtime, work, probe);

  const atlasUploadBatch = hasBudget() ? preparePhysicalAtlasUploadBatch(runtime, work, material) : [];
  const atlasStats = uploadPhysicalAtlasPageBatch(gl, atlas, atlasUploadBatch, probe, material);
  for (const prepared of atlasUploadBatch) clearPendingAtlasUpload(work, prepared.upload);

  const pageTableUploadBatch = hasBudget() ? takePageTableUploadBatch(work) : [];
  const pageTableUploadStart = performance.now();
  const pageTableResult = uploadVirtualTexturePageTableTexels(gl, pageTable, pageTableUploadBatch);
  const pageTableUploadMs = performance.now() - pageTableUploadStart;

  probe.bytesUploaded += pageTableResult.bytesUploaded;
  probe.detail = {
    ...probe.detail,
    baseResolveCount: work.initialBaseResolveCursor,
  };
  probe.evictedPageIds = [...work.evictedPageIds];
  if (pageTableUploadBatch.length > 0) {
    probe.lastPageTableUploadSample = pageTableUploadBatch.slice(0, 8).flatMap((upload) => upload.rgba8);
  }
  probe.pageTableTexelUploads += pageTableResult.texelsUploaded;
  recordAdvancePerformance(
    probe,
    performance.now() - started,
    atlasStats,
    material,
    planMs,
    pageTableResult.texelsUploaded,
    pageTableUploadMs,
    resolvedBasePages,
    work,
  );
  updateQualityProbe(runtime, probe, work);
  return hasPendingVirtualTextureWork(work);
};

const recordReadbackPerformance = (probe: VirtualTextureProbe, elapsedMs: number): void => {
  const timing = probe.performance;
  const rounded = roundTiming(elapsedMs);
  timing.lastReadbackMs = rounded;
  timing.maxReadbackMs = Math.max(timing.maxReadbackMs, rounded);
  timing.readbackCount += 1;
};

const serviceVirtualTextureReadback = (
  runtime: VirtualTextureRuntime,
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  previewTargets: ProbePreviewTargets,
  pageTable: VirtualTexturePageTableTexture,
  probe: VirtualTextureProbe,
  work: PendingVirtualTextureWork,
): void => {
  const request = work.pendingReadback;
  if (request === null) return;

  const started = performance.now();
  const sceneReadback = readCanvas(gl, request.width, request.height);
  probe.canvasReadback = sceneReadback;
  probe.terrainReadback = sceneReadback;
  probe.atlasPreviewReadback = readProbePreviewTarget(gl, previewTargets.atlas);
  probe.pageTablePreviewReadback = readProbePreviewTarget(gl, previewTargets.pageTable);
  probe.pageTableReadback = readTextureLevel(gl, framebuffer, pageTable);
  updateProbeFromRuntimeStats(
    probe,
    runtime.stats(),
    runtime.residentPageIds(),
    probe.pageTableReadback,
    probe.canvasReadback,
  );
  work.pendingReadback = null;
  probe.performance.pendingReadbacks = 0;
  recordReadbackPerformance(probe, performance.now() - started);
};

const cameraAllowsProbeReadback = (camera: CameraState, now = performance.now()): boolean =>
  !camera.interactionActive &&
  (camera.lastInteractionTime === 0 || now - camera.lastInteractionTime >= interactionReadbackQuietMs);

const chooseVirtualTextureSchedulerStrategy = (): VirtualTextureWorkSchedulerStrategy => {
  return 'set-timeout';
};

const recordSchedulerChunk = (
  probe: VirtualTextureProbe,
  strategy: VirtualTextureWorkSchedulerStrategy,
  budgetMs: number,
  delayMs: number,
  elapsedMs: number,
): void => {
  const timing = probe.performance;
  const roundedDelay = roundTiming(delayMs);
  const roundedElapsed = roundTiming(elapsedMs);
  timing.lastSchedulerDelayMs = roundedDelay;
  timing.lastWorkChunkMs = roundedElapsed;
  timing.maxSchedulerDelayMs = Math.max(timing.maxSchedulerDelayMs, roundedDelay);
  timing.maxWorkChunkMs = Math.max(timing.maxWorkChunkMs, roundedElapsed);
  timing.schedulerChunkCount += 1;
  timing.schedulerStrategy = strategy;
  timing.workChunkBudgetMs = budgetMs;
};

const createVirtualTextureWorkScheduler = (
  probe: VirtualTextureProbe,
  getChunkBudgetMs: () => number,
  drain: (budgetMs: number) => boolean,
): { readonly dispose: () => void; readonly request: () => void } => {
  const schedulerWindow = window as IdleSchedulerWindow;
  const strategy = chooseVirtualTextureSchedulerStrategy();
  let disposed = false;
  let idleHandle: number | null = null;
  let scheduled = false;
  let scheduledAt = 0;

  const run = (idleDeadline?: { readonly didTimeout: boolean; readonly timeRemaining: () => number }): void => {
    if (disposed) return;
    scheduled = false;
    idleHandle = null;

    const started = performance.now();
    const targetBudgetMs = getChunkBudgetMs();
    const idleBudgetMs = idleDeadline === undefined || idleDeadline.didTimeout
      ? targetBudgetMs
      : Math.min(targetBudgetMs, idleDeadline.timeRemaining());
    const budgetMs = Math.max(0.5, idleBudgetMs);
    const hasMore = drain(budgetMs);
    recordSchedulerChunk(probe, strategy, budgetMs, started - scheduledAt, performance.now() - started);
    if (hasMore) request();
  };

  const request = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    scheduledAt = performance.now();

    if (strategy === 'idle-callback' && schedulerWindow.requestIdleCallback !== undefined) {
      idleHandle = schedulerWindow.requestIdleCallback(run, { timeout: textureWorkIdleTimeoutMs });
      return;
    }

    if (strategy === 'post-task' && schedulerWindow.scheduler?.postTask !== undefined) {
      void schedulerWindow.scheduler.postTask(run, { priority: 'background' }).catch(() => {
        if (!disposed) window.setTimeout(run, 0);
      });
      return;
    }

    window.setTimeout(run, 0);
  };

  return {
    dispose: () => {
      disposed = true;
      if (idleHandle !== null && schedulerWindow.cancelIdleCallback !== undefined) {
        schedulerWindow.cancelIdleCallback(idleHandle);
      }
    },
    request,
  };
};

const createCameraController = (canvas: HTMLCanvasElement): CameraController => {
  const state: CameraState = {
    distance: 7.2,
    inputEvents: 0,
    interactionActive: false,
    lastTime: 0,
    lastInteractionTime: 0,
    moved: false,
    pitch: 0.62,
    revision: 0,
    targetX: 0,
    targetZ: 0,
    yaw: -0.72,
  };
  const keys = new Set<string>();
  const pointer = {
    active: false,
    lastX: 0,
    lastY: 0,
  };

  const markInteraction = (now = performance.now()): void => {
    state.inputEvents += 1;
    state.interactionActive = true;
    state.lastInteractionTime = now;
  };
  const markMoved = (now = performance.now()): void => {
    markInteraction(now);
    state.moved = true;
    state.revision += 1;
  };
  const onPointerDown = (event: PointerEvent): void => {
    pointer.active = true;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    markInteraction();
    canvas.setPointerCapture(event.pointerId);
    canvas.focus();
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!pointer.active) return;
    const deltaX = event.clientX - pointer.lastX;
    const deltaY = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    state.yaw += deltaX * 0.006;
    state.pitch = clamp(state.pitch + deltaY * 0.004, 0.24, 1.18);
    markMoved();
  };
  const onPointerUp = (event: PointerEvent): void => {
    pointer.active = false;
    markInteraction();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: WheelEvent): void => {
    state.distance = clamp(state.distance * Math.exp(event.deltaY * 0.001), minCameraDistance, maxCameraDistance);
    markMoved();
    event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key)) return;
    keys.add(key);
    markMoved();
    event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.key.toLowerCase());
  };
  const update = (now: number): void => {
    const deltaSeconds = state.lastTime === 0 ? 0 : Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.interactionActive = pointer.active ||
      (state.lastInteractionTime > 0 && now - state.lastInteractionTime < interactionReadbackQuietMs);
    if (keys.size === 0 || deltaSeconds === 0) return;

    const speed = deltaSeconds * state.distance * 0.62;
    const previousTargetX = state.targetX;
    const previousTargetZ = state.targetZ;
    const forwardX = -Math.sin(state.yaw);
    const forwardZ = -Math.cos(state.yaw);
    const rightX = Math.cos(state.yaw);
    const rightZ = -Math.sin(state.yaw);

    if (keys.has('w') || keys.has('arrowup')) {
      state.targetX += forwardX * speed;
      state.targetZ += forwardZ * speed;
    }
    if (keys.has('s') || keys.has('arrowdown')) {
      state.targetX -= forwardX * speed;
      state.targetZ -= forwardZ * speed;
    }
    if (keys.has('d') || keys.has('arrowright')) {
      state.targetX += rightX * speed;
      state.targetZ += rightZ * speed;
    }
    if (keys.has('a') || keys.has('arrowleft')) {
      state.targetX -= rightX * speed;
      state.targetZ -= rightZ * speed;
    }

    state.targetX = clamp(state.targetX, -terrainPanLimit, terrainPanLimit);
    state.targetZ = clamp(state.targetZ, -terrainPanLimit, terrainPanLimit);
    if (state.targetX !== previousTargetX || state.targetZ !== previousTargetZ) markMoved(now);
  };
  const dispose = (): void => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('keyup', onKeyUp);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('keyup', onKeyUp);

  return { dispose, state, update };
};

const viewProjectionMatrix = (camera: CameraState, width: number, height: number): Float32Array => {
  const horizontal = Math.cos(camera.pitch) * camera.distance;
  const target: Vec3 = [camera.targetX, 0, camera.targetZ];
  const eye: Vec3 = [
    target[0] + Math.sin(camera.yaw) * horizontal,
    target[1] + Math.sin(camera.pitch) * camera.distance,
    target[2] + Math.cos(camera.yaw) * horizontal,
  ];
  const projection = perspectiveMatrix(Math.PI / 4.1, width / Math.max(1, height), 0.1, 40);
  const view = lookAtMatrix(eye, target, [0, 1, 0]);

  return multiplyMatrix(projection, view);
};

const drawTerrain = (
  gl: WebGL2RenderingContext,
  renderer: TerrainProgram,
  mesh: TerrainMesh,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  camera: CameraState,
  width: number,
  height: number,
): void => {
  const pageTableBase = pageTable.mipDimensions[0];
  if (pageTableBase === undefined) throw new Error('Virtual texture page table is missing base level');

  gl.useProgram(renderer.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pageTable.texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  gl.uniform1i(renderer.uniforms.pageTable, 0);
  gl.uniform1i(renderer.uniforms.physicalAtlas, 1);
  gl.uniform2f(renderer.uniforms.pageTableSize, pageTableBase.width, pageTableBase.height);
  gl.uniform2f(renderer.uniforms.atlasSlots, atlas.slotColumns, atlas.slotRows);
  gl.uniform3f(renderer.uniforms.lightDirection, -0.42, 0.82, 0.36);
  gl.uniformMatrix4fv(renderer.uniforms.viewProjection, false, viewProjectionMatrix(camera, width, height));
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
};

const drawPreviewTexture = (
  gl: WebGL2RenderingContext,
  renderer: PreviewProgram,
  quad: FullscreenQuad,
  target: ProbePreviewTarget,
  texture: WebGLTexture,
  mode: 0 | 1,
  gridSize: readonly [number, number],
  atlas: PhysicalAtlasTexture,
): void => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(renderer.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(renderer.uniforms.texture, 0);
  gl.uniform1i(renderer.uniforms.mode, mode);
  gl.uniform2f(renderer.uniforms.gridSize, gridSize[0], gridSize[1]);
  gl.uniform2f(renderer.uniforms.atlasSlots, atlas.slotColumns, atlas.slotRows);
  gl.bindVertexArray(quad.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
};

const drawProbePreviews = (
  gl: WebGL2RenderingContext,
  renderer: PreviewProgram,
  quad: FullscreenQuad,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  targets: ProbePreviewTargets,
): void => {
  const pageTableBase = pageTable.mipDimensions[0];
  if (pageTableBase === undefined) throw new Error('Virtual texture page table is missing base level');

  drawPreviewTexture(
    gl,
    renderer,
    quad,
    targets.atlas,
    atlas.texture,
    0,
    [atlas.slotColumns, atlas.slotRows],
    atlas,
  );
  drawPreviewTexture(
    gl,
    renderer,
    quad,
    targets.pageTable,
    pageTable.texture,
    1,
    [pageTableBase.width, pageTableBase.height],
    atlas,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

const drawVirtualTexture = (
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  terrainProgram: TerrainProgram,
  terrainMesh: TerrainMesh,
  previewProgram: PreviewProgram,
  previewQuad: FullscreenQuad,
  previewTargets: ProbePreviewTargets,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  camera: CameraState,
  probe: VirtualTextureProbe,
): VirtualTextureReadbackRequest => {
  const [width, height] = resizeCanvas(canvas);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0.055, 0.075, 0.09, 1);
  gl.clearDepth(1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawTerrain(gl, terrainProgram, terrainMesh, pageTable, atlas, camera, width, height);

  gl.disable(gl.DEPTH_TEST);
  drawProbePreviews(gl, previewProgram, previewQuad, pageTable, atlas, previewTargets);

  probe.drawCalls += 3;
  probe.terrainDrawCalls += 1;
  probe.previewDrawCalls += 2;
  probe.camera = cameraProbe(camera);

  return { height, width };
};

const createWebGl2Context = (canvas: HTMLCanvasElement): WebGL2RenderingContext | null =>
  canvas.getContext('webgl2', rootOptions) as WebGL2RenderingContext | null;

const virtualTextureExampleStyle = {
  background: 'rgb(9 13 15)',
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  height: '100%',
  minHeight: 0,
} satisfies CSSProperties;

const virtualTextureControlsStyle = {
  alignItems: 'center',
  background: 'var(--panel)',
  borderBottom: '1px solid var(--line)',
  display: 'grid',
  gap: '0.65rem',
  gridTemplateColumns: 'minmax(9rem, 13rem) minmax(10rem, 1fr) minmax(6rem, auto)',
  padding: '0.68rem 0.78rem',
} satisfies CSSProperties;

const virtualTextureControlLabelStyle = {
  color: 'var(--muted)',
  fontSize: '0.72rem',
  fontWeight: 750,
  letterSpacing: 0,
  textTransform: 'uppercase',
} satisfies CSSProperties;

const virtualTextureRangeStyle = {
  accentColor: 'var(--accent)',
  inlineSize: '100%',
  minWidth: 0,
} satisfies CSSProperties;

const virtualTextureOutputStyle = {
  color: 'var(--fg)',
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  fontSize: '0.78rem',
  fontWeight: 700,
  textAlign: 'right',
  whiteSpace: 'nowrap',
} satisfies CSSProperties;

const startVirtualTextureDemo = (
  canvas: HTMLCanvasElement,
  settings: { readonly current: VirtualTextureDemoSettings },
  probe: VirtualTextureProbe,
): (() => void) => {
  const gl = createWebGl2Context(canvas);
  if (gl === null) {
    probe.error = 'WebGL2 is unavailable';
    return () => undefined;
  }

  probe.mode = 'webgl2-virtual-texture';
  probe.supported = true;

  const runtime = new VirtualTextureRuntime({
    pageSize,
    physicalSlots,
    virtualSize,
  });
  const snapshot = runtime.debugSnapshot();
  const pageTable = createVirtualTexturePageTableTexture(
    gl,
    virtualTexturePageTableMipDimensions({
      mipCount: runtime.mipCount,
      pageSize,
      virtualSize,
    }),
  );
  const atlas = createPhysicalAtlasTexture(gl, snapshot);
  const framebuffer = gl.createFramebuffer();
  const terrainProgram = createTerrainProgram(gl);
  const previewProgram = createPreviewProgram(gl);
  const terrainMesh = createTerrainMesh(gl, terrainProgram.program);
  const previewQuad = createFullscreenVertexArray(gl, previewProgram.program);
  const previewTargets = createProbePreviewTargets(gl);
  const camera = createCameraController(canvas);
  const pageGenerator = createWorkerBackedTerrainPageGenerator();
  const material = createTerrainVirtualTextureMaterialAdapter(pageGenerator);
  const work = emptyPendingVirtualTextureWork();
  if (framebuffer === null) throw new Error('Failed to create virtual-texture readback framebuffer');
  const workScheduler = createVirtualTextureWorkScheduler(
    probe,
    () => camera.state.interactionActive ? interactiveTextureWorkChunkBudgetMs : textureWorkChunkBudgetMs,
    (budgetMs) => {
      serviceVirtualTextureRuntime(
        runtime,
        gl,
        pageTable,
        atlas,
        material,
        settings.current,
        camera.state,
        probe,
        work,
        budgetMs,
      );
      const allowReadback = cameraAllowsProbeReadback(camera.state);
      if (!allowReadback && work.pendingReadback !== null) {
        work.pendingReadback = null;
        probe.performance.pendingReadbacks = 0;
      }
      if (
        allowReadback &&
        work.pendingReadback !== null &&
        (probe.ready || (pendingWorkPages(work) === 0 && work.initialBaseResolveCursor >= basePages.length))
      ) {
        serviceVirtualTextureReadback(runtime, gl, framebuffer, previewTargets, pageTable, probe, work);
      }

      return hasPendingVirtualTextureWork(work);
    });

  let animationFrame = 0;
  let lastFrameTime = 0;
  let lastProbeReadback = -probeReadbackIntervalMs;
  let disposed = false;

  const tick = (now: number): void => {
    if (disposed) return;
    if (lastFrameTime > 0) recordFrameTime(probe, now - lastFrameTime);
    lastFrameTime = now;
    camera.update(now);
    const allowReadback = cameraAllowsProbeReadback(camera.state, now);
    if (!allowReadback && work.pendingReadback !== null) {
      work.pendingReadback = null;
      probe.performance.pendingReadbacks = 0;
    }
    const shouldReadProbe = allowReadback &&
      (probe.frameCount < 2 || now - lastProbeReadback >= probeReadbackIntervalMs);
    const readbackRequest = drawVirtualTexture(
      canvas,
      gl,
      terrainProgram,
      terrainMesh,
      previewProgram,
      previewQuad,
      previewTargets,
      pageTable,
      atlas,
      camera.state,
      probe,
    );
    if (shouldReadProbe) {
      queueProbeReadback(work, readbackRequest);
      probe.performance.pendingReadbacks = 1;
      lastProbeReadback = now;
    }
    workScheduler.request();
    probe.frameCount += 1;
    animationFrame = requestAnimationFrame(tick);
  };

  animationFrame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    workScheduler.dispose();
    pageGenerator.dispose();
    camera.dispose();
    gl.deleteBuffer(previewQuad.buffer);
    gl.deleteBuffer(terrainMesh.indexBuffer);
    gl.deleteBuffer(terrainMesh.vertexBuffer);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteFramebuffer(previewTargets.atlas.framebuffer);
    gl.deleteFramebuffer(previewTargets.pageTable.framebuffer);
    gl.deleteProgram(previewProgram.program);
    gl.deleteProgram(terrainProgram.program);
    gl.deleteTexture(previewTargets.atlas.texture);
    gl.deleteTexture(previewTargets.pageTable.texture);
    gl.deleteTexture(atlas.texture);
    gl.deleteTexture(pageTable.texture);
    gl.deleteVertexArray(previewQuad.vao);
    gl.deleteVertexArray(terrainMesh.vao);
  };
};

export const VirtualTexturingTerrain = (): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef<VirtualTextureDemoSettings>({
    maxResidentDetail: defaultMaxResidentDetail,
  });
  const [maxResidentDetail, setMaxResidentDetail] = useState(defaultMaxResidentDetail);
  const effectiveResolution = pageSize * 2 ** maxResidentDetail;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error('Virtual texturing canvas ref was not attached');

    const probe = emptyProbe();
    window.__royalVirtualTextureProbe = probe;

    let stop = (): void => undefined;
    try {
      stop = startVirtualTextureDemo(canvas, settingsRef, probe);
    } catch (error) {
      probe.error = error instanceof Error ? error.message : String(error);
    }

    return () => {
      stop();
      if (window.__royalVirtualTextureProbe === probe) {
        delete window.__royalVirtualTextureProbe;
      }
    };
  }, []);

  const handleDetailChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = clamp(Math.round(Number(event.currentTarget.value)), 0, maxVirtualMip);
    settingsRef.current = { maxResidentDetail: next };
    setMaxResidentDetail(next);
  };

  return (
    <div data-virtual-texture-example="" style={virtualTextureExampleStyle}>
      <div data-virtual-texture-controls="" style={virtualTextureControlsStyle}>
        <label htmlFor="virtual-texture-detail-budget" style={virtualTextureControlLabelStyle}>
          Resident detail {maxResidentDetail}/{maxVirtualMip}
        </label>
        <input
          aria-label="Virtual texture resident detail"
          data-virtual-texture-detail-slider=""
          id="virtual-texture-detail-budget"
          max={maxVirtualMip}
          min={0}
          name="virtual-texture-detail-budget"
          onChange={handleDetailChange}
          step={1}
          style={virtualTextureRangeStyle}
          type="range"
          value={maxResidentDetail}
        />
        <output
          data-virtual-texture-effective-resolution={effectiveResolution}
          htmlFor="virtual-texture-detail-budget"
          style={virtualTextureOutputStyle}
        >
          {effectiveResolution}px cap
        </output>
      </div>
      <canvas
        aria-label="Virtual texturing terrain"
        ref={canvasRef}
        style={{ minHeight: 0 }}
        tabIndex={0}
      />
    </div>
  );
};
