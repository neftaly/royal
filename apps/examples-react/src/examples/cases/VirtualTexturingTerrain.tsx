import {
  VirtualTextureRuntime,
  createVirtualTexturePageTableTexture,
  planVirtualTextureUploads,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageId,
  virtualTexturePageTableMipDimensions,
  type VirtualTextureDebugSnapshot,
  type VirtualTexturePageAddress,
  type VirtualTexturePageId,
  type VirtualTexturePageTableTexture,
  type VirtualTexturePhysicalAtlasPageUpload,
  type VirtualTextureUploadPlan,
} from '../../../../../packages/renderer-webgl/src/virtual-texturing';
import { createElement, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';

type PhysicalAtlasTexture = {
  readonly slotColumns: number;
  readonly slotRows: number;
  readonly texture: WebGLTexture;
};

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
  readonly moved: boolean;
  readonly pitch: number;
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
  lastTime: number;
  moved: boolean;
  pitch: number;
  targetX: number;
  targetZ: number;
  yaw: number;
};

type CameraController = {
  readonly dispose: () => void;
  readonly state: CameraState;
  readonly update: (now: number) => void;
};

type Rect = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type PreviewRects = {
  readonly atlas: Rect;
  readonly pageTable: Rect;
};

type VirtualTextureDemoSettings = {
  readonly maxResidentDetail: number;
};

type VirtualTextureMaterialRequestContext = {
  readonly camera: CameraState;
  readonly frame: number;
  readonly maxResidentDetail: number;
};

type VirtualTextureMaterialRequestPlan = {
  readonly basePagesToResolve: readonly VirtualTexturePageAddress[];
  readonly detail: VirtualTextureDetailProbe;
  readonly pagesToMakeResident: readonly VirtualTexturePageAddress[];
};

type VirtualTextureMaterialAdapter = {
  readonly createPagePixels: (upload: VirtualTexturePhysicalAtlasPageUpload) => Uint8Array;
  readonly planRequests: (context: VirtualTextureMaterialRequestContext) => VirtualTextureMaterialRequestPlan;
};

type Vec3 = readonly [number, number, number];

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
const defaultMaxResidentDetail = 2;
const physicalSlots = 16;
const terrainSegments = 96;
const terrainWorldSize = 8.5;
const terrainPanLimit = 2.4;
const terrainVertexStride = 8;
const minCameraDistance = 2.4;
const maxCameraDistance = 12;
const detailRequestRadius = 1;
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
out vec3 v_worldPosition;
out vec2 v_uv;

void main() {
  v_normal = a_normal;
  v_worldPosition = a_position;
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
in vec3 v_worldPosition;
in vec2 v_uv;
out vec4 outColor;

vec3 sampleVirtualTexture(vec2 uv, out float pageLine, out float exactBlend) {
  vec2 virtualPage = min(floor(uv * u_pageTableSize), u_pageTableSize - vec2(1.0));
  vec2 pageUv = fract(uv * u_pageTableSize);
  vec4 entry = texelFetch(u_pageTable, ivec2(virtualPage), 0);
  float valid = step(0.5 / 255.0, entry.a);
  vec2 slot = floor(entry.rg * 255.0 + 0.5);
  float mipDelta = max(1.0, exp2(floor(entry.b * 255.0 + 0.5)));
  vec2 fallbackOffset = mod(virtualPage, mipDelta) / mipDelta;
  vec2 atlasUv = (slot + fallbackOffset + pageUv / mipDelta) / u_atlasSlots;
  vec3 atlasColor = texture(u_physicalAtlas, atlasUv).rgb;
  float edgeDistance = min(min(pageUv.x, pageUv.y), min(1.0 - pageUv.x, 1.0 - pageUv.y));

  pageLine = 1.0 - smoothstep(0.0, 0.018, edgeDistance);
  exactBlend = 1.0 - step(1.5 / 255.0, entry.b);
  return mix(vec3(0.16, 0.025, 0.055), atlasColor, valid);
}

void main() {
  float pageLine = 0.0;
  float exactBlend = 0.0;
  vec3 textureColor = sampleVirtualTexture(clamp(v_uv, vec2(0.0), vec2(1.0)), pageLine, exactBlend);
  vec3 normal = normalize(v_normal);
  float light = clamp(dot(normal, normalize(u_lightDirection)), 0.0, 1.0);
  float slopeShade = smoothstep(0.52, 0.12, normal.y) * 0.12;
  vec3 fallbackTint = mix(vec3(0.72, 0.78, 0.86), vec3(1.0), exactBlend);
  vec3 shaded = textureColor * fallbackTint * (0.34 + light * 0.68 + slopeShade);
  shaded = mix(shaded, vec3(0.92, 0.97, 1.0), pageLine * 0.28);
  float horizonFog = smoothstep(5.5, 12.5, length(v_worldPosition.xz));
  vec3 fogColor = vec3(0.33, 0.43, 0.51);

  outColor = vec4(mix(shaded, fogColor, horizonFog * 0.35), 1.0);
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
  moved: false,
  pitch: 0,
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
  physicalAtlasUploads: 0,
  previewDrawCalls: 0,
  ready: false,
  residentPageIds: [],
  supported: false,
  terrainDrawCalls: 0,
  terrainReadback: emptyReadback(),
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const clampByte = (value: number): number => clamp(Math.round(value), 0, 255);

const smoothStep = (edge0: number, edge1: number, value: number): number => {
  const range = edge1 - edge0;
  const t = range === 0 ? 0 : clamp((value - edge0) / range, 0, 1);
  return t * t * (3 - 2 * t);
};

const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

const mixColor = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): readonly [number, number, number] => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

const fract = (value: number): number => value - Math.floor(value);

const hash2 = (x: number, y: number): number => {
  const dot = x * 127.1 + y * 311.7;
  return fract(Math.sin(dot) * 43_758.5453);
};

const gridLine = (coordinate: number, spacing: number, width: number): number => {
  const phase = fract(coordinate / spacing);
  const distance = Math.min(phase, 1 - phase) * spacing;

  return 1 - smoothStep(width * 0.45, width, distance);
};

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

const terrainElevation = (u: number, v: number): number => {
  const x = (clamp(u, 0, 1) - 0.5) * 2;
  const z = (clamp(v, 0, 1) - 0.5) * 2;
  const ridge = Math.sin((x * 1.14 - z * 0.38) * Math.PI) * 0.16;
  const crossRidge = Math.sin((x * 0.42 + z * 1.28) * Math.PI * 1.3) * 0.08;
  const peak = Math.exp(-((x + 0.18) ** 2 * 5.6 + (z - 0.03) ** 2 * 7.2)) * 1.1;
  const shoulder = Math.exp(-((x - 0.34) ** 2 * 8.2 + (z + 0.36) ** 2 * 4.8)) * 0.48;
  const basin = Math.exp(-((x + 0.56) ** 2 * 9 + (z + 0.42) ** 2 * 8)) * 0.34;

  return -0.28 + peak + shoulder + ridge + crossRidge - basin;
};

const terrainNormal = (u: number, v: number): Vec3 => {
  const step = 1 / terrainSegments;
  const left = terrainElevation(u - step, v);
  const right = terrainElevation(u + step, v);
  const down = terrainElevation(u, v - step);
  const up = terrainElevation(u, v + step);
  const slopeX = (right - left) / (step * 2 * terrainWorldSize);
  const slopeZ = (up - down) / (step * 2 * terrainWorldSize);

  return normalizeVec3([-slopeX, 1, -slopeZ]);
};

const terrainColorAt = (
  u: number,
  v: number,
): readonly [number, number, number] => {
  const height = terrainElevation(u, v);
  const moisture = Math.sin((u * 5.3 + v * 2.1) * Math.PI) * 0.5 + 0.5;
  const virtualX = clamp(u, 0, 1) * (virtualSize[0] - 1);
  const virtualY = clamp(v, 0, 1) * (virtualSize[1] - 1);
  const texelX = Math.floor(virtualX);
  const texelY = Math.floor(virtualY);
  const noise = hash2(texelX, texelY);
  const detail = Math.sin((u * 193 + v * 89) * Math.PI) * 0.5 + 0.5;
  const lowland = [84, 122, 78] as const;
  const grass = [106, 156, 88] as const;
  const scrub = [142, 136, 86] as const;
  const rock = [128, 127, 122] as const;
  const snow = [228, 233, 226] as const;
  const wet = [58, 94, 92] as const;
  const ink = [32, 42, 48] as const;
  const surveyCyan = [96, 226, 216] as const;
  const surveyAmber = [240, 202, 96] as const;
  const grassMix = mixColor(lowland, grass, smoothStep(-0.18, 0.32, height));
  const scrubMix = mixColor(grassMix, scrub, smoothStep(0.16, 0.5, height) * (1 - moisture * 0.3));
  const rockMix = mixColor(scrubMix, rock, smoothStep(0.48, 0.86, height + detail * 0.08));
  const snowMix = mixColor(rockMix, snow, smoothStep(0.9, 1.12, height + detail * 0.05));
  const dampMix = mixColor(wet, snowMix, smoothStep(-0.32, -0.06, height + moisture * 0.08));
  const contourPhase = Math.abs(fract((height + 1.45) * 18) - 0.5) * 2;
  const contour = 1 - smoothStep(0.06, 0.12, contourPhase);
  const majorGrid = Math.max(gridLine(virtualX, 256, 2.2), gridLine(virtualY, 256, 2.2));
  const minorGrid = Math.max(gridLine(virtualX, 64, 1.35), gridLine(virtualY, 64, 1.35));
  const microGrid = Math.max(gridLine(virtualX, 16, 0.72), gridLine(virtualY, 16, 0.72));
  const diagonal = gridLine((virtualX + virtualY) * 0.7071, 32, 0.8);
  const tileX = Math.floor(virtualX / 256);
  const tileY = Math.floor(virtualY / 256);
  const tileU = fract(virtualX / 256);
  const tileV = fract(virtualY / 256);
  const markerColumn = Math.floor((tileU - 0.055) / 0.027);
  const markerRow = Math.floor((tileV - 0.06) / 0.035);
  const markerBand = tileU > 0.055 && tileU < 0.34 && tileV > 0.06 && tileV < 0.19;
  const markerBit = markerBand &&
    ((tileX * 13 + tileY * 29 + markerColumn * 5 + markerRow * 7) % 11 < 5);
  const grain = 0.92 + noise * 0.12 + detail * 0.04;
  const contourColor = mixColor(ink, surveyAmber, smoothStep(0.62, 1.02, height));
  const gridColor = mixColor(surveyCyan, ink, smoothStep(0.0, 0.8, height));
  const marked = markerBit ? mixColor(dampMix, surveyAmber, 0.78) : dampMix;
  const withMinorGrid = mixColor(marked, gridColor, minorGrid * 0.34 + microGrid * 0.2 + diagonal * 0.14);
  const withMajorGrid = mixColor(withMinorGrid, surveyCyan, majorGrid * 0.72);
  const withContour = mixColor(withMajorGrid, contourColor, contour * 0.64);

  return [
    clampByte(withContour[0] * grain),
    clampByte(withContour[1] * (0.94 + moisture * 0.1)),
    clampByte(withContour[2] * (0.94 + detail * 0.08)),
  ];
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
      const y = terrainElevation(u, v);
      const normal = terrainNormal(u, v);

      vertices[vertexOffset] = x;
      vertices[vertexOffset + 1] = y;
      vertices[vertexOffset + 2] = z;
      vertices[vertexOffset + 3] = normal[0];
      vertices[vertexOffset + 4] = normal[1];
      vertices[vertexOffset + 5] = normal[2];
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

const pagesAtVirtualMip = (mip: number): readonly [number, number] => [
  Math.max(1, Math.ceil(basePageColumns / 2 ** mip)),
  Math.max(1, Math.ceil(basePageRows / 2 ** mip)),
];

const pageVirtualUv = (
  page: VirtualTexturePageAddress,
  localU: number,
  localV: number,
): readonly [number, number] => {
  const [mipColumns, mipRows] = pagesAtVirtualMip(page.mip);

  return [
    clamp((page.x + localU) / mipColumns, 0, 1),
    clamp((page.y + localV) / mipRows, 0, 1),
  ];
};

const createTerrainPhysicalPagePixels = (
  upload: VirtualTexturePhysicalAtlasPageUpload,
): Uint8Array => {
  const pixels = new Uint8Array(upload.width * upload.height * 4);

  for (let y = 0; y < upload.height; y += 1) {
    for (let x = 0; x < upload.width; x += 1) {
      const index = (y * upload.width + x) * 4;
      const localU = upload.width <= 1 ? 0 : x / (upload.width - 1);
      const localV = upload.height <= 1 ? 0 : y / (upload.height - 1);
      const [virtualU, virtualV] = pageVirtualUv(upload.sourcePage, localU, localV);
      const color = terrainColorAt(virtualU, virtualV);
      const edge = x < 2 || y < 2 || x >= upload.width - 2 || y >= upload.height - 2;

      pixels[index] = edge ? 20 : color[0];
      pixels[index + 1] = edge ? 28 : color[1];
      pixels[index + 2] = edge ? 36 : color[2];
      pixels[index + 3] = 255;
    }
  }

  return pixels;
};

const cameraFocusUv = (camera: CameraState): readonly [number, number] => [
  clamp(camera.targetX / terrainWorldSize + 0.5, 0, 1),
  clamp(camera.targetZ / terrainWorldSize + 0.5, 0, 1),
];

const detailFromCameraZoom = (camera: CameraState): number => {
  const zoomedIn = 1 - (camera.distance - minCameraDistance) / (maxCameraDistance - minCameraDistance);
  return clamp(Math.round(2 + clamp(zoomedIn, 0, 1) * (maxVirtualMip - 2)), 0, maxVirtualMip);
};

const detailToMip = (detail: number): number => maxVirtualMip - clamp(Math.round(detail), 0, maxVirtualMip);

const focusPagesForMip = (
  mip: number,
  focusU: number,
  focusV: number,
): readonly VirtualTexturePageAddress[] => {
  const [columns, rows] = pagesAtVirtualMip(mip);
  const centerX = clamp(Math.floor(focusU * columns), 0, columns - 1);
  const centerY = clamp(Math.floor(focusV * rows), 0, rows - 1);
  const pages: VirtualTexturePageAddress[] = [];

  for (let y = centerY - detailRequestRadius; y <= centerY + detailRequestRadius; y += 1) {
    for (let x = centerX - detailRequestRadius; x <= centerX + detailRequestRadius; x += 1) {
      if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
      pages.push({ mip, x, y });
    }
  }

  return pages;
};

const uniquePages = (pages: readonly VirtualTexturePageAddress[]): readonly VirtualTexturePageAddress[] => {
  const byId = new Map<VirtualTexturePageId, VirtualTexturePageAddress>();
  for (const page of pages) byId.set(virtualTexturePageId(page), page);
  return [...byId.values()];
};

const createTerrainVirtualTextureMaterialAdapter = (): VirtualTextureMaterialAdapter => ({
  createPagePixels: createTerrainPhysicalPagePixels,
  planRequests: ({ camera, maxResidentDetail }) => {
    const [focusU, focusV] = cameraFocusUv(camera);
    const cappedDetail = clamp(Math.round(maxResidentDetail), 0, maxVirtualMip);
    const requestedDetail = Math.min(detailFromCameraZoom(camera), cappedDetail);
    const requestedMip = detailToMip(requestedDetail);
    const pagesToMakeResident = uniquePages([
      rootPage,
      ...focusPagesForMip(requestedMip, focusU, focusV),
    ]);
    const requestedPageIds = pagesToMakeResident.map(virtualTexturePageId);

    return {
      basePagesToResolve: basePages,
      detail: {
        baseResolveCount: basePages.length,
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
      pagesToMakeResident,
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
    gl.readPixels(0, 0, mip.width, mip.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

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

const readCanvasRegion = (
  gl: WebGL2RenderingContext,
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasReadback => {
  const left = clamp(Math.floor(x), 0, Math.max(0, gl.drawingBufferWidth - 1));
  const bottom = clamp(Math.floor(y), 0, Math.max(0, gl.drawingBufferHeight - 1));
  const regionWidth = Math.max(1, Math.min(Math.floor(width), gl.drawingBufferWidth - left));
  const regionHeight = Math.max(1, Math.min(Math.floor(height), gl.drawingBufferHeight - bottom));
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
        if (alpha !== 0 && (red > 8 || green > 8 || blue > 8)) painted += 1;
        buckets.add(`${red >> 5}:${green >> 5}:${blue >> 5}:${alpha >> 6}`);
      }
    }
  }

  return {
    colorBuckets: buckets.size,
    paintedRatio: painted / Math.max(1, texels),
  };
};

const readCanvas = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): CanvasReadback => readCanvasRegion(gl, 0, 0, width, height);

const residentPageIds = (snapshot: VirtualTextureDebugSnapshot): readonly VirtualTexturePageId[] =>
  snapshot.slots
    .map((slot) => slot.pageId)
    .filter((pageId): pageId is VirtualTexturePageId => pageId !== null);

const cameraProbe = (state: CameraState): CameraProbe => ({
  distance: Number(state.distance.toFixed(3)),
  moved: state.moved,
  pitch: Number(state.pitch.toFixed(3)),
  targetX: Number(state.targetX.toFixed(3)),
  targetZ: Number(state.targetZ.toFixed(3)),
  yaw: Number(state.yaw.toFixed(3)),
});

const updateProbeFromSnapshot = (
  probe: VirtualTextureProbe,
  snapshot: VirtualTextureDebugSnapshot,
  pageTableReadback: PageTableReadback,
  canvasReadback: CanvasReadback,
): void => {
  const exactPageCount = snapshot.pageTableEntries.filter((entry) => entry.mipDelta === 0).length;
  const fallbackPageCount = snapshot.pageTableEntries.filter((entry) => (entry.mipDelta ?? 0) > 0).length;
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

  probe.canvasReadback = canvasReadback;
  probe.exactPageCount = exactPageCount;
  probe.fallbackPageCount = fallbackPageCount;
  probe.pageTableReadback = pageTableReadback;
  probe.ready = probe.supported &&
    probe.frameCount >= 2 &&
    probe.pageTableTexelUploads >= basePages.length &&
    probe.physicalAtlasUploads >= 2 &&
    pageTableReadback.nonZeroTexels >= basePages.length &&
    canvasReadback.colorBuckets >= 6 &&
    fallbackPageCount > 0 &&
    detailReady &&
    terrainReady &&
    previewReady;
  probe.residentPageIds = residentPageIds(snapshot);
};

const uploadPhysicalAtlasPages = (
  gl: WebGL2RenderingContext,
  atlas: PhysicalAtlasTexture,
  plan: VirtualTextureUploadPlan,
  probe: VirtualTextureProbe,
  material: VirtualTextureMaterialAdapter,
): void => {
  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  for (const upload of plan.physicalAtlasUploads) {
    const pixels = material.createPagePixels(upload);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      upload.level,
      upload.xOffset,
      upload.yOffset,
      upload.width,
      upload.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    probe.bytesUploaded += upload.byteLength;
    probe.lastPhysicalAtlasUpload = upload.residentPageId;
    probe.physicalAtlasUploads += 1;
  }
};

const advanceVirtualTexture = (
  runtime: VirtualTextureRuntime,
  gl: WebGL2RenderingContext,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  framebuffer: WebGLFramebuffer,
  material: VirtualTextureMaterialAdapter,
  settings: VirtualTextureDemoSettings,
  camera: CameraState,
  probe: VirtualTextureProbe,
): void => {
  const frame = probe.frameCount;
  const requestPlan = material.planRequests({
    camera,
    frame,
    maxResidentDetail: settings.maxResidentDetail,
  });
  const evicted = new Set<VirtualTexturePageId>(probe.evictedPageIds);

  for (const page of requestPlan.pagesToMakeResident) {
    const result = runtime.makeResident(page, frame);
    if (result.evicted !== null) evicted.add(result.evicted.id);
  }
  for (const page of requestPlan.basePagesToResolve) runtime.resolve(page, frame);

  const dirtyEntries = runtime.drainDirtyEntries(frame);
  const plan = planVirtualTextureUploads(dirtyEntries, { pageSize });
  const pageTableResult = uploadVirtualTexturePageTableTexels(gl, pageTable, plan.pageTableUploads);
  uploadPhysicalAtlasPages(gl, atlas, plan, probe, material);

  probe.bytesUploaded += pageTableResult.bytesUploaded;
  probe.detail = requestPlan.detail;
  probe.evictedPageIds = [...evicted];
  probe.frameCount += 1;
  probe.lastPageTableUploadSample = plan.pageTableUploads.slice(0, 8).flatMap((upload) => upload.rgba8);
  probe.pageTableTexelUploads += pageTableResult.texelsUploaded;
  probe.pageTableReadback = readTextureLevel(gl, framebuffer, pageTable);
};

const createCameraController = (canvas: HTMLCanvasElement): CameraController => {
  const state: CameraState = {
    distance: 7.2,
    lastTime: 0,
    moved: false,
    pitch: 0.62,
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

  const markMoved = (): void => {
    state.moved = true;
  };
  const onPointerDown = (event: PointerEvent): void => {
    pointer.active = true;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
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
    if (keys.size === 0 || deltaSeconds === 0) return;

    const speed = deltaSeconds * state.distance * 0.62;
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
  const target: Vec3 = [camera.targetX, 0.2, camera.targetZ];
  const eye: Vec3 = [
    target[0] + Math.sin(camera.yaw) * horizontal,
    target[1] + Math.sin(camera.pitch) * camera.distance,
    target[2] + Math.cos(camera.yaw) * horizontal,
  ];
  const projection = perspectiveMatrix(Math.PI / 4.1, width / Math.max(1, height), 0.1, 40);
  const view = lookAtMatrix(eye, target, [0, 1, 0]);

  return multiplyMatrix(projection, view);
};

const previewRects = (width: number, height: number, atlas: PhysicalAtlasTexture): PreviewRects => {
  const margin = Math.max(10, Math.round(Math.min(width, height) * 0.026));
  const atlasWidth = Math.round(Math.min(width * 0.34, height * 0.38));
  const atlasHeight = Math.round(atlasWidth * (atlas.slotRows / atlas.slotColumns));
  const pageTableSize = Math.round(Math.min(width * 0.15, height * 0.2));
  const atlasX = Math.max(margin, width - atlasWidth - margin);
  const atlasY = margin;

  return {
    atlas: {
      height: atlasHeight,
      width: atlasWidth,
      x: atlasX,
      y: atlasY,
    },
    pageTable: {
      height: pageTableSize,
      width: pageTableSize,
      x: Math.max(margin, width - pageTableSize - margin),
      y: atlasY + atlasHeight + margin,
    },
  };
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
  rect: Rect,
  texture: WebGLTexture,
  mode: 0 | 1,
  gridSize: readonly [number, number],
  atlas: PhysicalAtlasTexture,
): void => {
  gl.viewport(rect.x, rect.y, rect.width, rect.height);
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

const drawDebugPreviews = (
  gl: WebGL2RenderingContext,
  renderer: PreviewProgram,
  quad: FullscreenQuad,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  width: number,
  height: number,
): PreviewRects => {
  const rects = previewRects(width, height, atlas);
  const pageTableBase = pageTable.mipDimensions[0];
  if (pageTableBase === undefined) throw new Error('Virtual texture page table is missing base level');

  drawPreviewTexture(
    gl,
    renderer,
    quad,
    rects.atlas,
    atlas.texture,
    0,
    [atlas.slotColumns, atlas.slotRows],
    atlas,
  );
  drawPreviewTexture(
    gl,
    renderer,
    quad,
    rects.pageTable,
    pageTable.texture,
    1,
    [pageTableBase.width, pageTableBase.height],
    atlas,
  );

  return rects;
};

const drawVirtualTexture = (
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  terrainProgram: TerrainProgram,
  terrainMesh: TerrainMesh,
  previewProgram: PreviewProgram,
  previewQuad: FullscreenQuad,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  camera: CameraState,
  probe: VirtualTextureProbe,
): void => {
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
  const rects = drawDebugPreviews(gl, previewProgram, previewQuad, pageTable, atlas, width, height);

  probe.drawCalls += 3;
  probe.terrainDrawCalls += 1;
  probe.previewDrawCalls += 2;
  probe.camera = cameraProbe(camera);
  probe.canvasReadback = readCanvas(gl, width, height);
  probe.terrainReadback = readCanvasRegion(
    gl,
    Math.round(width * 0.1),
    Math.round(height * 0.12),
    Math.round(width * 0.58),
    Math.round(height * 0.55),
  );
  probe.atlasPreviewReadback = readCanvasRegion(
    gl,
    rects.atlas.x,
    rects.atlas.y,
    rects.atlas.width,
    rects.atlas.height,
  );
  probe.pageTablePreviewReadback = readCanvasRegion(
    gl,
    rects.pageTable.x,
    rects.pageTable.y,
    rects.pageTable.width,
    rects.pageTable.height,
  );
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
  const camera = createCameraController(canvas);
  const material = createTerrainVirtualTextureMaterialAdapter();
  if (framebuffer === null) throw new Error('Failed to create virtual-texture readback framebuffer');

  let animationFrame = 0;
  let lastAdvance = 0;
  let disposed = false;

  const tick = (now: number): void => {
    if (disposed) return;
    camera.update(now);
    if (probe.frameCount < 2 || now - lastAdvance >= 240) {
      advanceVirtualTexture(
        runtime,
        gl,
        pageTable,
        atlas,
        framebuffer,
        material,
        settings.current,
        camera.state,
        probe,
      );
      lastAdvance = now;
    }
    drawVirtualTexture(
      canvas,
      gl,
      terrainProgram,
      terrainMesh,
      previewProgram,
      previewQuad,
      pageTable,
      atlas,
      camera.state,
      probe,
    );
    updateProbeFromSnapshot(probe, runtime.debugSnapshot(), probe.pageTableReadback, probe.canvasReadback);
    animationFrame = requestAnimationFrame(tick);
  };

  animationFrame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    camera.dispose();
    gl.deleteBuffer(previewQuad.buffer);
    gl.deleteBuffer(terrainMesh.indexBuffer);
    gl.deleteBuffer(terrainMesh.vertexBuffer);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteProgram(previewProgram.program);
    gl.deleteProgram(terrainProgram.program);
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

  return createElement(
    'div',
    {
      'data-virtual-texture-example': '',
      style: virtualTextureExampleStyle,
    },
    createElement(
      'div',
      {
        'data-virtual-texture-controls': '',
        style: virtualTextureControlsStyle,
      },
      createElement(
        'label',
        {
          htmlFor: 'virtual-texture-detail-budget',
          style: virtualTextureControlLabelStyle,
        },
        `Resident detail ${maxResidentDetail}/${maxVirtualMip}`,
      ),
      createElement('input', {
        'aria-label': 'Virtual texture resident detail',
        'data-virtual-texture-detail-slider': '',
        id: 'virtual-texture-detail-budget',
        max: maxVirtualMip,
        min: 0,
        name: 'virtual-texture-detail-budget',
        onChange: handleDetailChange,
        step: 1,
        style: virtualTextureRangeStyle,
        type: 'range',
        value: maxResidentDetail,
      }),
      createElement(
        'output',
        {
          'data-virtual-texture-effective-resolution': effectiveResolution,
          htmlFor: 'virtual-texture-detail-budget',
          style: virtualTextureOutputStyle,
        },
        `${effectiveResolution}px cap`,
      ),
    ),
    createElement('canvas', {
      'aria-label': 'Virtual texturing terrain',
      ref: canvasRef,
      style: { minHeight: 0 },
      tabIndex: 0,
    }),
  );
};
