import {
  VirtualTextureRuntime,
  createVirtualTexturePageTableTexture,
  planVirtualTextureUploads,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageTableMipDimensions,
  type VirtualTextureDebugSnapshot,
  type VirtualTexturePageAddress,
  type VirtualTexturePageId,
  type VirtualTexturePageTableTexture,
  type VirtualTexturePhysicalAtlasPageUpload,
  type VirtualTextureUploadPlan,
} from '../../../../../packages/renderer-webgl/src/virtual-texturing';
import { createElement, useEffect, useRef, type ReactNode } from 'react';

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

type VirtualTextureProbe = {
  bytesUploaded: number;
  canvasReadback: CanvasReadback;
  drawCalls: number;
  error: string;
  evictedPageIds: readonly VirtualTexturePageId[];
  exactPageCount: number;
  fallbackPageCount: number;
  frameCount: number;
  lastPageTableUploadSample: readonly number[];
  lastPhysicalAtlasUpload: string;
  mode: 'webgl2-virtual-texture' | 'webgl2-unavailable';
  pageTableReadback: PageTableReadback;
  pageTableTexelUploads: number;
  physicalAtlasUploads: number;
  ready: boolean;
  residentPageIds: readonly VirtualTexturePageId[];
  supported: boolean;
};

declare global {
  interface Window {
    __royalVirtualTextureProbe?: VirtualTextureProbe;
  }
}

const virtualSize = [256, 256] as const;
const pageSize = 64;
const physicalSlots = 6;
const rootPage = { mip: 2, x: 0, y: 0 } as const satisfies VirtualTexturePageAddress;
const basePages = Array.from({ length: 16 }, (_, index): VirtualTexturePageAddress => ({
  mip: 0,
  x: index % 4,
  y: Math.floor(index / 4),
}));
const focusPagesByStep: readonly (readonly VirtualTexturePageAddress[])[] = [
  [],
  [
    { mip: 0, x: 0, y: 0 },
    { mip: 0, x: 1, y: 0 },
    { mip: 0, x: 0, y: 1 },
    { mip: 0, x: 1, y: 1 },
  ],
  [
    { mip: 0, x: 1, y: 1 },
    { mip: 0, x: 2, y: 1 },
    { mip: 0, x: 1, y: 2 },
    { mip: 0, x: 2, y: 2 },
  ],
  [
    { mip: 0, x: 2, y: 2 },
    { mip: 0, x: 3, y: 2 },
    { mip: 0, x: 2, y: 3 },
    { mip: 0, x: 3, y: 3 },
  ],
] as const;
const rootOptions = {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: true,
} as const;
const vertexShaderSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;
const fragmentShaderSource = `#version 300 es
precision highp float;

uniform sampler2D u_pageTable;
uniform sampler2D u_physicalAtlas;
uniform vec2 u_atlasSlots;
uniform vec2 u_pageTableSize;

in vec2 v_uv;
out vec4 outColor;

void main() {
  vec2 virtualPage = min(floor(v_uv * u_pageTableSize), u_pageTableSize - vec2(1.0));
  vec2 pageUv = fract(v_uv * u_pageTableSize);
  vec4 entry = texelFetch(u_pageTable, ivec2(virtualPage), 0);
  float valid = step(0.5 / 255.0, entry.a);
  vec2 slot = floor(entry.rg * 255.0 + 0.5);
  float mipDelta = max(1.0, exp2(floor(entry.b * 255.0 + 0.5)));
  vec2 fallbackOffset = mod(virtualPage, mipDelta) / mipDelta;
  vec2 atlasUv = (slot + fallbackOffset + pageUv / mipDelta) / u_atlasSlots;
  vec3 atlasColor = texture(u_physicalAtlas, atlasUv).rgb;
  float line = max(step(pageUv.x, 0.025), step(pageUv.y, 0.025));
  float exact = 1.0 - step(1.5 / 255.0, entry.b);
  vec3 fallbackTint = mix(vec3(0.78, 0.84, 0.92), vec3(1.0), exact);
  vec3 sampled = atlasColor * fallbackTint;
  vec3 missing = vec3(0.18, 0.025, 0.05);
  vec3 color = mix(missing, sampled, valid);

  outColor = vec4(mix(color, vec3(0.94, 0.98, 1.0), line * 0.34), 1.0);
}
`;

const emptyProbe = (): VirtualTextureProbe => ({
  bytesUploaded: 0,
  canvasReadback: { colorBuckets: 0, paintedRatio: 0 },
  drawCalls: 0,
  error: '',
  evictedPageIds: [],
  exactPageCount: 0,
  fallbackPageCount: 0,
  frameCount: 0,
  lastPageTableUploadSample: [],
  lastPhysicalAtlasUpload: '',
  mode: 'webgl2-unavailable',
  pageTableReadback: { nonZeroTexels: 0, texels: 0, uniqueEntries: 0 },
  pageTableTexelUploads: 0,
  physicalAtlasUploads: 0,
  ready: false,
  residentPageIds: [],
  supported: false,
});

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const createShader = (
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('Failed to create virtual-texture shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
};

const createProgram = (gl: WebGL2RenderingContext): WebGLProgram => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (program === null) throw new Error('Failed to create virtual-texture shader program');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(message);
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

const createFullscreenVertexArray = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): { readonly buffer: WebGLBuffer; readonly vao: WebGLVertexArrayObject } => {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  if (vao === null || buffer === null) throw new Error('Failed to create virtual-texture quad');

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
  if (position < 0) throw new Error('Missing virtual-texture quad attribute');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  return { buffer, vao };
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

const tileBaseColor = (page: VirtualTexturePageAddress): readonly [number, number, number] => {
  const colors = [
    [236, 88, 72],
    [248, 176, 64],
    [94, 184, 112],
    [61, 151, 218],
    [184, 112, 224],
    [42, 190, 190],
    [235, 126, 159],
    [176, 196, 72],
  ] as const;
  const index = (page.mip * 5 + page.x * 3 + page.y * 7) % colors.length;
  return colors[index] ?? colors[0];
};

const createPhysicalPagePixels = (
  upload: VirtualTexturePhysicalAtlasPageUpload,
): Uint8Array => {
  const pixels = new Uint8Array(upload.width * upload.height * 4);
  const color = tileBaseColor(upload.sourcePage);
  const mipScale = 1 - upload.sourcePage.mip * 0.16;

  for (let y = 0; y < upload.height; y += 1) {
    for (let x = 0; x < upload.width; x += 1) {
      const index = (y * upload.width + x) * 4;
      const u = upload.width <= 1 ? 0 : x / (upload.width - 1);
      const v = upload.height <= 1 ? 0 : y / (upload.height - 1);
      const checker = (Math.floor(x / 8) + Math.floor(y / 8) + upload.sourcePage.x + upload.sourcePage.y) % 2;
      const stripe = checker === 0 ? 1 : 0.72;
      const edge = x < 2 || y < 2 || x >= upload.width - 2 || y >= upload.height - 2;

      pixels[index] = edge ? 24 : clampByte(color[0] * (0.56 + u * 0.38) * stripe * mipScale);
      pixels[index + 1] = edge ? 32 : clampByte(color[1] * (0.58 + v * 0.36) * stripe * mipScale);
      pixels[index + 2] = edge ? 42 : clampByte((color[2] + upload.uploadSerial * 18) * stripe * mipScale);
      pixels[index + 3] = 255;
    }
  }

  return pixels;
};

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

const readCanvas = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): CanvasReadback => {
  const sampleColumns = Math.max(1, Math.min(4, width));
  const sampleRows = Math.max(1, Math.min(4, height));
  const sampleWidth = Math.max(1, Math.min(24, Math.floor(width / sampleColumns)));
  const sampleHeight = Math.max(1, Math.min(24, Math.floor(height / sampleRows)));
  const maxX = width - sampleWidth;
  const maxY = height - sampleHeight;
  const pixels = new Uint8Array(sampleWidth * sampleHeight * 4);

  const buckets = new Set<string>();
  let painted = 0;
  let texels = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const y = sampleRows === 1 ? 0 : Math.round((maxY * row) / (sampleRows - 1));
    for (let column = 0; column < sampleColumns; column += 1) {
      const x = sampleColumns === 1 ? 0 : Math.round((maxX * column) / (sampleColumns - 1));
      gl.readPixels(x, y, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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
    paintedRatio: painted / texels,
  };
};

const residentPageIds = (snapshot: VirtualTextureDebugSnapshot): readonly VirtualTexturePageId[] =>
  snapshot.slots
    .map((slot) => slot.pageId)
    .filter((pageId): pageId is VirtualTexturePageId => pageId !== null);

const updateProbeFromSnapshot = (
  probe: VirtualTextureProbe,
  snapshot: VirtualTextureDebugSnapshot,
  pageTableReadback: PageTableReadback,
  canvasReadback: CanvasReadback,
): void => {
  const exactPageCount = snapshot.pageTableEntries.filter((entry) => entry.mipDelta === 0).length;
  const fallbackPageCount = snapshot.pageTableEntries.filter((entry) => (entry.mipDelta ?? 0) > 0).length;

  probe.canvasReadback = canvasReadback;
  probe.exactPageCount = exactPageCount;
  probe.fallbackPageCount = fallbackPageCount;
  probe.pageTableReadback = pageTableReadback;
  probe.ready = probe.supported &&
    probe.frameCount >= focusPagesByStep.length &&
    probe.pageTableTexelUploads >= basePages.length &&
    probe.physicalAtlasUploads >= 5 &&
    pageTableReadback.nonZeroTexels >= basePages.length &&
    canvasReadback.colorBuckets >= 6;
  probe.residentPageIds = residentPageIds(snapshot);
};

const uploadPhysicalAtlasPages = (
  gl: WebGL2RenderingContext,
  atlas: PhysicalAtlasTexture,
  plan: VirtualTextureUploadPlan,
  probe: VirtualTextureProbe,
): void => {
  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  for (const upload of plan.physicalAtlasUploads) {
    const pixels = createPhysicalPagePixels(upload);
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
  probe: VirtualTextureProbe,
): void => {
  const frame = probe.frameCount;
  const focusPages = focusPagesByStep[frame % focusPagesByStep.length] ?? [];
  const evicted = new Set<VirtualTexturePageId>(probe.evictedPageIds);

  if (frame === 0) runtime.makeResident(rootPage, frame);
  for (const page of focusPages) {
    const result = runtime.makeResident(page, frame);
    if (result.evicted !== null) evicted.add(result.evicted.id);
  }
  for (const page of basePages) runtime.resolve(page, frame);

  const dirtyEntries = runtime.drainDirtyEntries(frame);
  const plan = planVirtualTextureUploads(dirtyEntries, { pageSize });
  const pageTableResult = uploadVirtualTexturePageTableTexels(gl, pageTable, plan.pageTableUploads);
  uploadPhysicalAtlasPages(gl, atlas, plan, probe);

  probe.bytesUploaded += pageTableResult.bytesUploaded;
  probe.evictedPageIds = [...evicted];
  probe.frameCount += 1;
  probe.lastPageTableUploadSample = plan.pageTableUploads.slice(0, 8).flatMap((upload) => upload.rgba8);
  probe.pageTableTexelUploads += pageTableResult.texelsUploaded;
  probe.pageTableReadback = readTextureLevel(gl, framebuffer, pageTable);
};

const drawVirtualTexture = (
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  vao: WebGLVertexArrayObject,
  pageTable: VirtualTexturePageTableTexture,
  atlas: PhysicalAtlasTexture,
  probe: VirtualTextureProbe,
): void => {
  const [width, height] = resizeCanvas(canvas);
  const pageTableBase = pageTable.mipDimensions[0];
  if (pageTableBase === undefined) throw new Error('Virtual texture page table is missing base level');

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0.02, 0.025, 0.03, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, pageTable.texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
  gl.uniform1i(requireUniform(gl, program, 'u_pageTable'), 0);
  gl.uniform1i(requireUniform(gl, program, 'u_physicalAtlas'), 1);
  gl.uniform2f(requireUniform(gl, program, 'u_pageTableSize'), pageTableBase.width, pageTableBase.height);
  gl.uniform2f(requireUniform(gl, program, 'u_atlasSlots'), atlas.slotColumns, atlas.slotRows);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);

  probe.drawCalls += 1;
  probe.canvasReadback = readCanvas(gl, width, height);
};

const createWebGl2Context = (canvas: HTMLCanvasElement): WebGL2RenderingContext | null =>
  canvas.getContext('webgl2', rootOptions) as WebGL2RenderingContext | null;

const startVirtualTextureDemo = (canvas: HTMLCanvasElement, probe: VirtualTextureProbe): (() => void) => {
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
  const program = createProgram(gl);
  const { buffer, vao } = createFullscreenVertexArray(gl, program);
  if (framebuffer === null) throw new Error('Failed to create virtual-texture readback framebuffer');

  let animationFrame = 0;
  let lastAdvance = 0;
  let disposed = false;

  const tick = (now: number): void => {
    if (disposed) return;
    if (probe.frameCount < focusPagesByStep.length || now - lastAdvance >= 520) {
      advanceVirtualTexture(runtime, gl, pageTable, atlas, framebuffer, probe);
      lastAdvance = now;
    }
    drawVirtualTexture(canvas, gl, program, vao, pageTable, atlas, probe);
    updateProbeFromSnapshot(probe, runtime.debugSnapshot(), probe.pageTableReadback, probe.canvasReadback);
    animationFrame = requestAnimationFrame(tick);
  };

  animationFrame = requestAnimationFrame(tick);

  return () => {
    disposed = true;
    cancelAnimationFrame(animationFrame);
    gl.deleteBuffer(buffer);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteProgram(program);
    gl.deleteTexture(atlas.texture);
    gl.deleteTexture(pageTable.texture);
    gl.deleteVertexArray(vao);
  };
};

export const VirtualTexturingTerrain = (): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error('Virtual texturing canvas ref was not attached');

    const probe = emptyProbe();
    window.__royalVirtualTextureProbe = probe;

    let stop = (): void => undefined;
    try {
      stop = startVirtualTextureDemo(canvas, probe);
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

  return createElement('canvas', {
    'aria-label': 'Virtual texturing terrain',
    ref: canvasRef,
  });
};
