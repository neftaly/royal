import type { LinearRgba } from "@royal/renderer-core";
import type { SurfaceFrameView } from "../frame/surface-frame";
import { identityMat4 } from "../math/mat4";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type {
  MutableSurfaceDrawFrame,
  SurfaceDrawPacket,
  TextureUnitBinding,
} from "../webgl/draw-state-transition";
import {
  compileWebGlShader,
  linkWebGlProgram,
  requiredWebGlUniform,
} from "../webgl/program";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type {
  CanonicalEdgeOverlayScene,
  CanonicalEdgeSurface,
} from "./edge-overlay-scene";
import {
  SCREEN_SPACE_PARTITION_BUCKET_BITS,
  SCREEN_SPACE_PARTITION_PATTERN_SIZE,
  type ScreenSpacePartitionPatternOwner,
} from "./screen-space-partition-pattern";
import {
  frustumPlanesInto,
  worldBoundsVisible,
} from "./surface-visibility";
import type {
  BorrowedSurfaceGeometryMatch,
} from "./surface-gpu-owner";

const MASK_CLEAR: LinearRgba = [0, 0, 0, 0];
const IDENTITY_MODEL = identityMat4();
const BATCH_INSTANCE_FLOATS = 17;
const MAX_EDGE_RADIUS_FRAMEBUFFER_PIXELS = 64;
const CREASE_NORMAL_COSINE = 0.866_025_4;

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
const vec2 positions[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);
out vec2 textureCoordinate;
void main() {
  vec2 position = positions[gl_VertexID];
  textureCoordinate = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const EDGE_MASK_VERTEX_SHADER = `#version 300 es
invariant gl_Position;
layout(location = 0) in vec3 position;
#ifdef INSTANCED
layout(location = 3) in mat4 instanceModel;
#endif
#ifdef BATCHED
layout(location = 7) in float instanceObjectId;
flat out float maskObjectId;
#endif
uniform mat4 model;
uniform mat4 view;
uniform mat4 viewProjection;
out highp vec3 viewPosition;
void main() {
  vec4 localPosition = vec4(position, 1.0);
#ifdef INSTANCED
  localPosition = instanceModel * localPosition;
#endif
  vec4 worldPosition = model * localPosition;
  viewPosition = (view * worldPosition).xyz;
  gl_Position = viewProjection * worldPosition;
#ifdef BATCHED
  maskObjectId = instanceObjectId;
#endif
}`;

export const EDGE_MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in highp vec3 viewPosition;
#ifdef BATCHED
flat in float maskObjectId;
#else
uniform float objectId;
#endif
out vec4 outputMask;
vec2 octEncode(vec3 normal) {
  normal /= abs(normal.x) + abs(normal.y) + abs(normal.z);
  vec2 encoded = normal.xy;
  if (normal.z < 0.0) {
    vec2 signNotZero = vec2(
      encoded.x < 0.0 ? -1.0 : 1.0,
      encoded.y < 0.0 ? -1.0 : 1.0
    );
    encoded = (1.0 - abs(encoded.yx)) * signNotZero;
  }
  return encoded * 0.5 + 0.5;
}
void main() {
  vec3 normal = normalize(cross(dFdx(viewPosition), dFdy(viewPosition)));
  if (!gl_FrontFacing) normal = -normal;
  outputMask = vec4(octEncode(normal),
#ifdef BATCHED
    maskObjectId,
#else
    objectId,
#endif
    1.0);
}`;

export const EDGE_HORIZONTAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 textureCoordinate;
uniform sampler2D edgeMask;
uniform vec2 texelSize;
uniform float horizontalRadius;
out vec4 outputSignal;
vec3 octDecode(vec2 encoded) {
  vec2 value = encoded * 2.0 - 1.0;
  vec3 normal = vec3(value, 1.0 - abs(value.x) - abs(value.y));
  if (normal.z < 0.0) {
    vec2 signNotZero = vec2(
      normal.x < 0.0 ? -1.0 : 1.0,
      normal.y < 0.0 ? -1.0 : 1.0
    );
    normal.xy = (1.0 - abs(normal.yx)) * signNotZero;
  }
  return normalize(normal);
}
float edgeSeed(vec4 center, vec4 neighbor) {
  bool centerCovered = center.a > 0.5;
  bool neighborCovered = neighbor.a > 0.5;
  if (centerCovered != neighborCovered) return centerCovered ? 1.0 : 0.0;
  if (!centerCovered) return 0.0;
  if (abs(center.b - neighbor.b) > (0.5 / 255.0)) {
    return center.b < neighbor.b ? 1.0 : 0.0;
  }
  if (dot(octDecode(center.rg), octDecode(neighbor.rg)) >= ${CREASE_NORMAL_COSINE}) {
    return 0.0;
  }
  if (abs(center.r - neighbor.r) > (0.5 / 255.0)) {
    return center.r < neighbor.r ? 1.0 : 0.0;
  }
  return center.g < neighbor.g ? 1.0 : 0.0;
}
float edgeAt(vec2 coordinate) {
  vec4 center = texture(edgeMask, coordinate);
  float edge = edgeSeed(center, texture(edgeMask, coordinate + vec2(texelSize.x, 0.0)));
  edge = max(edge, edgeSeed(center, texture(edgeMask, coordinate - vec2(texelSize.x, 0.0))));
  edge = max(edge, edgeSeed(center, texture(edgeMask, coordinate + vec2(0.0, texelSize.y))));
  edge = max(edge, edgeSeed(center, texture(edgeMask, coordinate - vec2(0.0, texelSize.y))));
  return edge;
}
void main() {
  float signal = 0.0;
  int radius = int(ceil(horizontalRadius));
  for (int offset = -radius; offset <= radius; offset += 1) {
    signal = max(
      signal,
      edgeAt(textureCoordinate + vec2(float(offset) * texelSize.x, 0.0))
    );
  }
  outputSignal = vec4(signal, 0.0, 0.0, 1.0);
}`;

export const EDGE_RESOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 textureCoordinate;
uniform sampler2D horizontalSignal;
uniform vec2 texelSize;
uniform float verticalRadius;
uniform vec4 edgeColor;
out vec4 outputColor;
void main() {
  float signal = 0.0;
  int radius = int(ceil(verticalRadius));
  for (int offset = -radius; offset <= radius; offset += 1) {
    signal = max(
      signal,
      texture(
        horizontalSignal,
        textureCoordinate + vec2(0.0, float(offset) * texelSize.y)
      ).r
    );
  }
  outputColor = vec4(edgeColor.rgb, edgeColor.a * signal);
}`;

export const EDGE_PARTITION_RESOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
in vec2 textureCoordinate;
uniform sampler2D horizontalSignal;
uniform vec2 texelSize;
uniform float verticalRadius;
uniform vec4 edgeColor;
uniform vec2 partitionCellSize;
uniform int partitionCount;
uniform int partitionIndex;
uniform highp usampler2D partitionPattern;
uniform vec2 viewportOrigin;
out vec4 outputColor;
void main() {
  float signal = 0.0;
  int radius = int(ceil(verticalRadius));
  for (int offset = -radius; offset <= radius; offset += 1) {
    signal = max(
      signal,
      texture(
        horizontalSignal,
        textureCoordinate + vec2(0.0, float(offset) * texelSize.y)
      ).r
    );
  }
  uvec2 cell = uvec2(floor((gl_FragCoord.xy - viewportOrigin) / partitionCellSize));
  uint bucket = texelFetch(
    partitionPattern,
    ivec2(cell & uvec2(${SCREEN_SPACE_PARTITION_PATTERN_SIZE - 1}u)),
    0
  ).r;
  float covered = (bucket * uint(partitionCount) >> ${SCREEN_SPACE_PARTITION_BUCKET_BITS}u)
    == uint(partitionIndex) ? 1.0 : 0.0;
  outputColor = vec4(edgeColor.rgb, edgeColor.a * signal * covered);
}`;

type MaskProgram = Readonly<{
  model: WebGLUniformLocation;
  objectId?: WebGLUniformLocation;
  program: WebGLProgram;
  view: WebGLUniformLocation;
  viewProjection: WebGLUniformLocation;
}>;

type HorizontalProgram = Readonly<{
  horizontalRadius: WebGLUniformLocation;
  program: WebGLProgram;
  texelSize: WebGLUniformLocation;
}>;

type ResolveProgram = Readonly<{
  edgeColor: WebGLUniformLocation;
  program: WebGLProgram;
  texelSize: WebGLUniformLocation;
  verticalRadius: WebGLUniformLocation;
}>;

type PartitionResolveProgram = ResolveProgram & Readonly<{
  partitionCellSize: WebGLUniformLocation;
  partitionCount: WebGLUniformLocation;
  partitionIndex: WebGLUniformLocation;
  viewportOrigin: WebGLUniformLocation;
}>;

type EdgePipeline = Readonly<{
  batchedMask: MaskProgram;
  fullscreenVertexArray: WebGLVertexArrayObject;
  horizontal: HorizontalProgram;
  instancedMask: MaskProgram;
  mask: MaskProgram;
  resolve: ResolveProgram;
  sampler: WebGLSampler;
}>;

type EdgeTargets = Readonly<{
  depth: WebGLTexture;
  height: number;
  mask: WebGLTexture;
  maskFramebuffer: WebGLFramebuffer;
  scratch: WebGLTexture;
  scratchFramebuffer: WebGLFramebuffer;
  width: number;
}>;

type ReadyBorrowedGeometry = Extract<
  BorrowedSurfaceGeometryMatch,
  { status: "ready" }
>["resource"];

type EdgeMaskDraw = Readonly<{
  objectId: number;
  resource: ReadyBorrowedGeometry;
  surface: CanonicalEdgeSurface;
}>;

type EdgeMaskBatch = Readonly<{
  draws: EdgeMaskDraw[];
  resource: ReadyBorrowedGeometry;
}>;

const planEdgeMaskBatches = (
  scene: CanonicalEdgeOverlayScene,
  run: CanonicalEdgeOverlayScene["runs"][number],
  matches: readonly BorrowedSurfaceGeometryMatch[],
  visible: (surface: CanonicalEdgeSurface) => boolean,
): Readonly<{ batches: readonly EdgeMaskBatch[]; pending: boolean }> => {
  const batches: EdgeMaskBatch[] = [];
  const ordinary = new Map<object, Map<number, EdgeMaskBatch>>();
  let pending = false;
  for (const occurrence of run.occurrences) {
    const drawnResources = new Set<object>();
    for (const surfaceIndex of occurrence.surfaceIndices) {
      const surface = scene.surfaces[surfaceIndex]!;
      if (!visible(surface)) continue;
      const match = matches[surfaceIndex]!;
      if (match.status === "pending") {
        pending = true;
        continue;
      }
      if (match.status !== "ready" || drawnResources.has(match.resource.identity)) {
        continue;
      }
      drawnResources.add(match.resource.identity);
      const draw = {
        objectId: occurrence.objectId,
        resource: match.resource,
        surface,
      };
      if (match.resource.instanceCount > 0) {
        batches.push({ draws: [draw], resource: match.resource });
        continue;
      }
      let byHandedness = ordinary.get(match.resource.geometry.identity);
      if (byHandedness === undefined) {
        byHandedness = new Map();
        ordinary.set(match.resource.geometry.identity, byHandedness);
      }
      let batch = byHandedness.get(surface.modelHandedness);
      if (batch === undefined) {
        batch = { draws: [], resource: match.resource };
        byHandedness.set(surface.modelHandedness, batch);
        batches.push(batch);
      }
      batch.draws.push(draw);
    }
  }
  return { batches, pending };
};

const compileProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram => {
  const vertex = compileWebGlShader(gl, gl.VERTEX_SHADER, vertexSource, label);
  let fragment: WebGLShader;
  try {
    fragment = compileWebGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource, label);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  try {
    return linkWebGlProgram(gl, vertex, fragment, label);
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
};

const maskProgram = (
  gl: WebGL2RenderingContext,
  mode: "batched" | "instanced" | "ordinary",
): MaskProgram => {
  const instanced = mode !== "ordinary";
  const batched = mode === "batched";
  const program = compileProgram(
    gl,
    EDGE_MASK_VERTEX_SHADER.replace(
      "\n",
      `\n${instanced ? "#define INSTANCED\n" : ""}${batched ? "#define BATCHED\n" : ""}`,
    ),
    EDGE_MASK_FRAGMENT_SHADER.replace(
      "\n",
      `\n${batched ? "#define BATCHED\n" : ""}`,
    ),
    "edge mask",
  );
  return {
    model: requiredWebGlUniform(gl, program, "model", "edge mask"),
    ...(batched
      ? {}
      : { objectId: requiredWebGlUniform(gl, program, "objectId", "edge mask") }),
    program,
    view: requiredWebGlUniform(gl, program, "view", "edge mask"),
    viewProjection: requiredWebGlUniform(gl, program, "viewProjection", "edge mask"),
  };
};

const horizontalProgram = (gl: WebGL2RenderingContext): HorizontalProgram => {
  const program = compileProgram(
    gl,
    FULLSCREEN_VERTEX_SHADER,
    EDGE_HORIZONTAL_FRAGMENT_SHADER,
    "edge horizontal expansion",
  );
  gl.useProgram(program);
  gl.uniform1i(
    requiredWebGlUniform(gl, program, "edgeMask", "edge horizontal expansion"),
    0,
  );
  return {
    horizontalRadius: requiredWebGlUniform(
      gl,
      program,
      "horizontalRadius",
      "edge horizontal expansion",
    ),
    program,
    texelSize: requiredWebGlUniform(
      gl,
      program,
      "texelSize",
      "edge horizontal expansion",
    ),
  };
};

const resolveProgram = (gl: WebGL2RenderingContext): ResolveProgram => {
  const program = compileProgram(
    gl,
    FULLSCREEN_VERTEX_SHADER,
    EDGE_RESOLVE_FRAGMENT_SHADER,
    "edge resolve",
  );
  gl.useProgram(program);
  gl.uniform1i(
    requiredWebGlUniform(gl, program, "horizontalSignal", "edge resolve"),
    0,
  );
  return {
    edgeColor: requiredWebGlUniform(gl, program, "edgeColor", "edge resolve"),
    program,
    texelSize: requiredWebGlUniform(gl, program, "texelSize", "edge resolve"),
    verticalRadius: requiredWebGlUniform(
      gl,
      program,
      "verticalRadius",
      "edge resolve",
    ),
  };
};

const partitionResolveProgram = (
  gl: WebGL2RenderingContext,
): PartitionResolveProgram => {
  const label = "partitioned edge resolve";
  const program = compileProgram(
    gl,
    FULLSCREEN_VERTEX_SHADER,
    EDGE_PARTITION_RESOLVE_FRAGMENT_SHADER,
    label,
  );
  try {
    gl.useProgram(program);
    gl.uniform1i(requiredWebGlUniform(gl, program, "horizontalSignal", label), 0);
    gl.uniform1i(requiredWebGlUniform(gl, program, "partitionPattern", label), 1);
    return {
      edgeColor: requiredWebGlUniform(gl, program, "edgeColor", label),
      partitionCellSize: requiredWebGlUniform(
        gl,
        program,
        "partitionCellSize",
        label,
      ),
      partitionCount: requiredWebGlUniform(gl, program, "partitionCount", label),
      partitionIndex: requiredWebGlUniform(gl, program, "partitionIndex", label),
      program,
      texelSize: requiredWebGlUniform(gl, program, "texelSize", label),
      verticalRadius: requiredWebGlUniform(gl, program, "verticalRadius", label),
      viewportOrigin: requiredWebGlUniform(gl, program, "viewportOrigin", label),
    };
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
};

const framebufferComplete = (
  gl: WebGL2RenderingContext,
  label: string,
): void => {
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Royal ${label} framebuffer is incomplete`);
  }
};

/** Owns the private normal/id mask and separable screen-space edge presentation. */
export class EdgeOverlayOwner {
  #batchBuffer: WebGLBuffer | null = null;
  #batchCapacityBytes = 0;
  readonly #batchClaim = {};
  #batchValues = new Float32Array(0);
  readonly #batchVertexArrays = new Map<
    object,
    { byteOffset: number; vertexArray: WebGLVertexArrayObject }
  >();
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  readonly #frustumPlanes = new Float32Array(24);
  readonly #gl: WebGL2RenderingContext;
  readonly #horizontalBindings: TextureUnitBinding[] = [{
    sampler: null,
    target: "2d",
    texture: null,
  }];
  readonly #horizontalFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #horizontalPacket: SurfaceDrawPacket | null = null;
  readonly #maskFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #pipeline: EdgePipeline | null = null;
  #partitionResolve: PartitionResolveProgram | null = null;
  readonly #partitionResolveBindings: TextureUnitBinding[] = [
    { sampler: null, target: "2d", texture: null },
    { sampler: null, target: "2d", texture: null },
  ];
  #partitionResolvePacket: SurfaceDrawPacket | null = null;
  readonly #partitionPattern: ScreenSpacePartitionPatternOwner;
  readonly #resolveBindings: TextureUnitBinding[] = [{
    sampler: null,
    target: "2d",
    texture: null,
  }];
  readonly #resolveFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #resolvePacket: SurfaceDrawPacket | null = null;
  #scene: CanonicalEdgeOverlayScene | null = null;
  #targets: EdgeTargets | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    budget: PersistentGpuBudgetOwner,
    partitionPattern: ScreenSpacePartitionPatternOwner,
  ) {
    this.#budget = budget;
    this.#gl = gl;
    this.#partitionPattern = partitionPattern;
  }

  setScene(scene: CanonicalEdgeOverlayScene | null): void {
    this.#scene = scene;
  }

  dispose(): void {
    this.#deleteTargets();
    this.#deleteBatchResources();
    const pipeline = this.#pipeline;
    if (pipeline !== null) {
      const gl = this.#gl;
      gl.deleteProgram(pipeline.batchedMask.program);
      gl.deleteProgram(pipeline.mask.program);
      gl.deleteProgram(pipeline.instancedMask.program);
      gl.deleteProgram(pipeline.horizontal.program);
      gl.deleteProgram(pipeline.resolve.program);
      gl.deleteSampler(pipeline.sampler);
      gl.deleteVertexArray(pipeline.fullscreenVertexArray);
    }
    if (this.#partitionResolve !== null) {
      this.#gl.deleteProgram(this.#partitionResolve.program);
    }
    this.#pipeline = null;
    this.#partitionResolve = null;
    this.#partitionResolvePacket = null;
    this.#horizontalPacket = null;
    this.#resolvePacket = null;
    this.#scene = null;
  }

  /** Drops context-invalid handles without issuing delete calls. */
  abandon(): void {
    this.#batchBuffer = null;
    this.#batchCapacityBytes = 0;
    this.#batchValues = new Float32Array(0);
    this.#batchVertexArrays.clear();
    this.#targets = null;
    this.#pipeline = null;
    this.#partitionResolve = null;
    this.#partitionResolvePacket = null;
    this.#horizontalPacket = null;
    this.#resolvePacket = null;
    this.#horizontalBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#resolveBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#partitionResolveBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#partitionResolveBindings[1] = { sampler: null, target: "2d", texture: null };
    this.#budget.release(this.#claim);
    this.#budget.release(this.#batchClaim);
  }

  drawViews(
    views: readonly SurfaceFrameView[],
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    cssScaleX: number,
    cssScaleY: number,
    borrow: (surface: CanonicalEdgeSurface) => BorrowedSurfaceGeometryMatch,
  ): boolean {
    const scene = this.#scene;
    if (scene === null || scene.runs.length === 0 || views.length === 0) return false;
    const matches = this.#preflight(scene, borrow);
    this.#reconcileBatchVertexArrays(matches);
    this.#ensurePipeline(state);
    if (scene.runs.some((run) => run.material.coverage !== undefined)) {
      this.#ensurePartitionResolve(state);
    }
    let pending = matches.some((match) => match.status === "pending");
    for (const view of views) {
      if (!this.#ensureTargets(view.viewport.width, view.viewport.height, state)) continue;
      frustumPlanesInto(this.#frustumPlanes, view.viewProjection);
      for (const run of scene.runs) {
        const result = this.#drawRun(
          scene,
          run,
          view,
          framebuffer,
          state,
          cssScaleX,
          cssScaleY,
          matches,
        );
        pending ||= result.pending;
      }
    }
    return pending;
  }

  #drawRun(
    scene: CanonicalEdgeOverlayScene,
    run: CanonicalEdgeOverlayScene["runs"][number],
    view: SurfaceFrameView,
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    cssScaleX: number,
    cssScaleY: number,
    matches: readonly BorrowedSurfaceGeometryMatch[],
  ): Readonly<{ pending: boolean }> {
    const targets = this.#targets!;
    const pipeline = this.#pipeline!;
    const gl = this.#gl;
    state.unbindTextureUnit(0);
    state.clear({
      clearColor: MASK_CLEAR,
      clearDepth: 1,
      framebuffer: targets.maskFramebuffer,
      scissor: null,
      size: { height: targets.height, width: targets.width },
      viewport: { height: targets.height, width: targets.width, x: 0, y: 0 },
    });
    this.#maskFrame.framebuffer = targets.maskFramebuffer;
    this.#maskFrame.viewport = {
      height: targets.height,
      width: targets.width,
      x: 0,
      y: 0,
    };
    const plan = planEdgeMaskBatches(
      scene,
      run,
      matches,
      (surface) => worldBoundsVisible(surface.worldBounds, this.#frustumPlanes),
    );
    const batchOffsets = this.#uploadBatches(plan.batches, state);
    for (const batch of plan.batches) {
      const resource = batch.resource;
      if (batch.draws.length > 1 && resource.instanceCount === 0) {
        this.#drawBatch(batch, batchOffsets.get(batch)!, view, state);
      } else {
        const { objectId, surface } = batch.draws[0]!;
        const program = resource.instanceCount > 0
          ? pipeline.instancedMask
          : pipeline.mask;
        const packet: SurfaceDrawPacket = {
          alphaBlend: false,
          colorWrite: true,
          cullBackFaces: false,
          depthTest: true,
          depthWrite: true,
          frontFace: surface.modelHandedness < 0 ? gl.CW : gl.CCW,
          program: program.program,
          textureBindings: [],
          textureUnits: 0,
          vertexArray: resource.vertexArray,
        };
        state.applySurfaceDraw(this.#maskFrame, packet);
        gl.uniformMatrix4fv(program.view, false, view.view);
        gl.uniformMatrix4fv(program.viewProjection, false, view.viewProjection);
        gl.uniformMatrix4fv(program.model, false, surface.model);
        gl.uniform1f(program.objectId!, objectId / 255);
        if (resource.instanceCount > 0) {
          gl.drawElementsInstanced(
            gl.TRIANGLES,
            resource.geometry.indexCount,
            resource.geometry.indexType,
            resource.geometry.indexOffset,
            resource.instanceCount,
          );
        } else {
          gl.drawElements(
            gl.TRIANGLES,
            resource.geometry.indexCount,
            resource.geometry.indexType,
            resource.geometry.indexOffset,
          );
        }
      }
    }
    if (plan.batches.length === 0) return { pending: plan.pending };

    const texelX = 1 / targets.width;
    const texelY = 1 / targets.height;
    const horizontalRadius = Math.min(
      MAX_EDGE_RADIUS_FRAMEBUFFER_PIXELS,
      Math.max(0, (run.material.widthCssPixels * cssScaleX - 1) * 0.5),
    );
    const verticalRadius = Math.min(
      MAX_EDGE_RADIUS_FRAMEBUFFER_PIXELS,
      Math.max(0, (run.material.widthCssPixels * cssScaleY - 1) * 0.5),
    );
    this.#horizontalFrame.framebuffer = targets.scratchFramebuffer;
    this.#horizontalFrame.viewport = {
      height: targets.height,
      width: targets.width,
      x: 0,
      y: 0,
    };
    state.applySurfaceDraw(this.#horizontalFrame, this.#horizontalPacket!);
    gl.uniform2f(pipeline.horizontal.texelSize, texelX, texelY);
    gl.uniform1f(pipeline.horizontal.horizontalRadius, horizontalRadius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.#resolveFrame.framebuffer = framebuffer;
    this.#resolveFrame.viewport = view.viewport;
    const coverage = run.material.coverage;
    if (coverage === undefined) {
      state.applySurfaceDraw(this.#resolveFrame, this.#resolvePacket!);
      gl.uniform2f(pipeline.resolve.texelSize, texelX, texelY);
      gl.uniform1f(pipeline.resolve.verticalRadius, verticalRadius);
      gl.uniform4fv(pipeline.resolve.edgeColor, run.material.color);
    } else {
      const resolve = this.#partitionResolve!;
      state.applySurfaceDraw(this.#resolveFrame, this.#partitionResolvePacket!);
      gl.uniform2f(resolve.texelSize, texelX, texelY);
      gl.uniform1f(resolve.verticalRadius, verticalRadius);
      gl.uniform4fv(resolve.edgeColor, run.material.color);
      gl.uniform2f(
        resolve.partitionCellSize,
        coverage.cellSizeCssPixels * cssScaleX,
        coverage.cellSizeCssPixels * cssScaleY,
      );
      gl.uniform1i(resolve.partitionCount, coverage.count);
      gl.uniform1i(resolve.partitionIndex, coverage.index);
      gl.uniform2f(resolve.viewportOrigin, view.viewport.x, view.viewport.y);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { pending: plan.pending };
  }

  #drawBatch(
    batch: EdgeMaskBatch,
    byteOffset: number,
    view: SurfaceFrameView,
    state: WebGlStateOwner,
  ): void {
    const gl = this.#gl;
    const program = this.#pipeline!.batchedMask;
    const resource = batch.resource;
    const geometry = resource.geometry;
    let binding = this.#batchVertexArrays.get(geometry.identity);
    if (binding === undefined) {
      const vertexArray = gl.createVertexArray();
      if (vertexArray === null) {
        throw new Error("Royal could not allocate a batched edge-mask vertex array");
      }
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      binding = { byteOffset: -1, vertexArray };
      this.#batchVertexArrays.set(geometry.identity, binding);
    }
    if (binding.byteOffset !== byteOffset) {
      gl.bindVertexArray(binding.vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#batchBuffer);
      const floatBytes = Float32Array.BYTES_PER_ELEMENT;
      const stride = BATCH_INSTANCE_FLOATS * floatBytes;
      for (let column = 0; column < 4; column += 1) {
        const location = 3 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          4,
          gl.FLOAT,
          false,
          stride,
          byteOffset + column * 4 * floatBytes,
        );
        gl.vertexAttribDivisor(location, 1);
      }
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(
        7,
        1,
        gl.FLOAT,
        false,
        stride,
        byteOffset + 16 * floatBytes,
      );
      gl.vertexAttribDivisor(7, 1);
      binding.byteOffset = byteOffset;
    }
    state.invalidate();
    state.applySurfaceDraw(this.#maskFrame, {
      alphaBlend: false,
      colorWrite: true,
      cullBackFaces: false,
      depthTest: true,
      depthWrite: true,
      frontFace: batch.draws[0]!.surface.modelHandedness < 0 ? gl.CW : gl.CCW,
      program: program.program,
      textureBindings: [],
      textureUnits: 0,
      vertexArray: binding.vertexArray,
    });
    gl.uniformMatrix4fv(program.view, false, view.view);
    gl.uniformMatrix4fv(program.viewProjection, false, view.viewProjection);
    gl.uniformMatrix4fv(program.model, false, IDENTITY_MODEL);
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      geometry.indexCount,
      geometry.indexType,
      geometry.indexOffset,
      batch.draws.length,
    );
  }

  #uploadBatches(
    batches: readonly EdgeMaskBatch[],
    state: WebGlStateOwner,
  ): ReadonlyMap<EdgeMaskBatch, number> {
    const offsets = new Map<EdgeMaskBatch, number>();
    let valueCount = 0;
    for (const batch of batches) {
      if (batch.draws.length < 2 || batch.resource.instanceCount > 0) continue;
      offsets.set(batch, valueCount * Float32Array.BYTES_PER_ELEMENT);
      valueCount += batch.draws.length * BATCH_INSTANCE_FLOATS;
    }
    if (valueCount === 0) return offsets;
    if (this.#batchValues.length < valueCount) {
      this.#batchValues = new Float32Array(valueCount);
    }
    let offset = 0;
    for (const batch of batches) {
      if (!offsets.has(batch)) continue;
      for (const { objectId, surface } of batch.draws) {
        this.#batchValues.set(surface.model, offset);
        this.#batchValues[offset + 16] = objectId / 255;
        offset += BATCH_INSTANCE_FLOATS;
      }
    }
    const byteLength = valueCount * Float32Array.BYTES_PER_ELEMENT;
    const gl = this.#gl;
    if (this.#batchBuffer === null) {
      this.#batchBuffer = gl.createBuffer();
      if (this.#batchBuffer === null) {
        throw new Error("Royal could not allocate edge-mask instance transforms");
      }
    }
    if (byteLength > this.#batchCapacityBytes) {
      if (!this.#budget.tryClaim(this.#batchClaim, byteLength)) {
        throw new Error("Royal persistent GPU budget denied edge-mask instances");
      }
      this.#batchCapacityBytes = byteLength;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#batchBuffer);
    // Orphan before the one packed upload so a hot overlay never waits for the
    // preceding mask draws to release this storage.
    gl.bufferData(gl.ARRAY_BUFFER, this.#batchCapacityBytes, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#batchValues, 0, valueCount);
    state.invalidate();
    return offsets;
  }

  #preflight(
    scene: CanonicalEdgeOverlayScene,
    borrow: (surface: CanonicalEdgeSurface) => BorrowedSurfaceGeometryMatch,
  ): readonly BorrowedSurfaceGeometryMatch[] {
    const matches = Array<BorrowedSurfaceGeometryMatch>(scene.surfaces.length);
    for (let index = 0; index < scene.surfaces.length; index += 1) {
      const surface = scene.surfaces[index]!;
      const match = borrow(surface);
      matches[index] = match;
      if (match.status !== "absent" && match.status !== "ambiguous") continue;
      const sourceTransform = surface.node.sourceTransform ?? surface.node.transform;
      const presentationTransform = surface.node.transform;
      const sourceLabel = sourceTransform === undefined
        ? "identity"
        : JSON.stringify(sourceTransform);
      const presentationLabel = presentationTransform === undefined
        ? "identity"
        : JSON.stringify(presentationTransform);
      throw new Error(
        `Royal outline glTF ${JSON.stringify(surface.asset.src)} source occurrence `
          + `transform ${sourceLabel} is ${match.status === "absent" ? "missing" : "ambiguous"} `
          + `in the base scene; presentation transform is ${presentationLabel}`,
      );
    }
    return matches;
  }

  #reconcileBatchVertexArrays(
    matches: readonly BorrowedSurfaceGeometryMatch[],
  ): void {
    const active = new Set(
      matches.flatMap((match) =>
        match.status === "ready" && match.resource.instanceCount === 0
          ? [match.resource.geometry.identity]
          : []
      ),
    );
    for (const [identity, { vertexArray }] of this.#batchVertexArrays) {
      if (active.has(identity)) continue;
      this.#gl.deleteVertexArray(vertexArray);
      this.#batchVertexArrays.delete(identity);
    }
  }

  #ensurePipeline(state: WebGlStateOwner): void {
    if (this.#pipeline !== null) return;
    const gl = this.#gl;
    const mask = maskProgram(gl, "ordinary");
    let instancedMask: MaskProgram | undefined;
    let batchedMask: MaskProgram | undefined;
    let horizontal: HorizontalProgram | undefined;
    let resolve: ResolveProgram | undefined;
    let sampler: WebGLSampler | null = null;
    let fullscreenVertexArray: WebGLVertexArrayObject | null = null;
    try {
      instancedMask = maskProgram(gl, "instanced");
      batchedMask = maskProgram(gl, "batched");
      horizontal = horizontalProgram(gl);
      resolve = resolveProgram(gl);
      sampler = gl.createSampler();
      fullscreenVertexArray = gl.createVertexArray();
      if (sampler === null || fullscreenVertexArray === null) {
        throw new Error("Royal could not allocate the edge overlay pipeline");
      }
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.#pipeline = {
        batchedMask,
        fullscreenVertexArray,
        horizontal,
        instancedMask,
        mask,
        resolve,
        sampler,
      };
      this.#rebuildPackets();
    } catch (error) {
      gl.deleteProgram(mask.program);
      if (instancedMask !== undefined) gl.deleteProgram(instancedMask.program);
      if (batchedMask !== undefined) gl.deleteProgram(batchedMask.program);
      if (horizontal !== undefined) gl.deleteProgram(horizontal.program);
      if (resolve !== undefined) gl.deleteProgram(resolve.program);
      if (sampler !== null) gl.deleteSampler(sampler);
      if (fullscreenVertexArray !== null) gl.deleteVertexArray(fullscreenVertexArray);
      throw error;
    } finally {
      state.invalidate();
    }
  }

  #ensurePartitionResolve(state: WebGlStateOwner): void {
    if (this.#partitionResolve !== null) return;
    const gl = this.#gl;
    const resolve = partitionResolveProgram(gl);
    try {
      this.#partitionPattern.ensure();
      this.#partitionResolve = resolve;
      this.#rebuildPackets();
    } catch (error) {
      gl.deleteProgram(resolve.program);
      throw error;
    } finally {
      state.invalidate();
    }
  }

  #ensureTargets(width: number, height: number, state: WebGlStateOwner): boolean {
    if (this.#targets?.width === width && this.#targets.height === height) return true;
    this.#deleteTargets();
    const bytes = width * height * 9;
    if (!Number.isSafeInteger(bytes) || !this.#budget.tryClaim(this.#claim, bytes)) {
      throw new Error("Royal persistent GPU budget denied the edge overlay targets");
    }
    const gl = this.#gl;
    const mask = gl.createTexture();
    const depth = gl.createTexture();
    const scratch = gl.createTexture();
    const maskFramebuffer = gl.createFramebuffer();
    const scratchFramebuffer = gl.createFramebuffer();
    if (
      mask === null
      || depth === null
      || scratch === null
      || maskFramebuffer === null
      || scratchFramebuffer === null
    ) {
      if (mask !== null) gl.deleteTexture(mask);
      if (depth !== null) gl.deleteTexture(depth);
      if (scratch !== null) gl.deleteTexture(scratch);
      if (maskFramebuffer !== null) gl.deleteFramebuffer(maskFramebuffer);
      if (scratchFramebuffer !== null) gl.deleteFramebuffer(scratchFramebuffer);
      this.#budget.release(this.#claim);
      throw new Error("Royal could not allocate the edge overlay targets");
    }
    try {
      gl.bindTexture(gl.TEXTURE_2D, mask);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
      gl.bindTexture(gl.TEXTURE_2D, scratch);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height);

      gl.bindFramebuffer(gl.FRAMEBUFFER, maskFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        mask,
        0,
      );
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        depth,
        0,
      );
      framebufferComplete(gl, "edge mask");
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        scratch,
        0,
      );
      framebufferComplete(gl, "edge expansion");
      this.#targets = {
        depth,
        height,
        mask,
        maskFramebuffer,
        scratch,
        scratchFramebuffer,
        width,
      };
      this.#rebuildPackets();
      return true;
    } catch (error) {
      gl.deleteTexture(mask);
      gl.deleteTexture(depth);
      gl.deleteTexture(scratch);
      gl.deleteFramebuffer(maskFramebuffer);
      gl.deleteFramebuffer(scratchFramebuffer);
      this.#budget.release(this.#claim);
      throw error;
    } finally {
      state.invalidate();
    }
  }

  #rebuildPackets(): void {
    const pipeline = this.#pipeline;
    const targets = this.#targets;
    if (pipeline === null || targets === null) {
      this.#horizontalPacket = null;
      this.#resolvePacket = null;
      this.#partitionResolvePacket = null;
      return;
    }
    this.#horizontalBindings[0] = {
      sampler: pipeline.sampler,
      target: "2d",
      texture: targets.mask,
    };
    this.#resolveBindings[0] = {
      sampler: pipeline.sampler,
      target: "2d",
      texture: targets.scratch,
    };
    this.#partitionResolveBindings[0] = {
      sampler: pipeline.sampler,
      target: "2d",
      texture: targets.scratch,
    };
    this.#partitionResolveBindings[1] = this.#partitionResolve === null
      ? { sampler: null, target: "2d", texture: null }
      : { ...this.#partitionPattern.binding };
    const gl = this.#gl;
    this.#horizontalPacket = {
      alphaBlend: false,
      colorWrite: true,
      cullBackFaces: false,
      depthTest: false,
      depthWrite: false,
      frontFace: gl.CCW,
      program: pipeline.horizontal.program,
      textureBindings: this.#horizontalBindings,
      textureUnits: 1,
      vertexArray: pipeline.fullscreenVertexArray,
    };
    this.#resolvePacket = {
      alphaBlend: true,
      colorWrite: true,
      cullBackFaces: false,
      depthTest: false,
      depthWrite: false,
      frontFace: gl.CCW,
      program: pipeline.resolve.program,
      textureBindings: this.#resolveBindings,
      textureUnits: 1,
      vertexArray: pipeline.fullscreenVertexArray,
    };
    this.#partitionResolvePacket = this.#partitionResolve === null
      ? null
      : {
          ...this.#resolvePacket,
          program: this.#partitionResolve.program,
          textureBindings: this.#partitionResolveBindings,
          textureUnits: 0b11,
        };
  }

  #deleteTargets(): void {
    const targets = this.#targets;
    if (targets === null) return;
    const gl = this.#gl;
    gl.deleteTexture(targets.mask);
    gl.deleteTexture(targets.depth);
    gl.deleteTexture(targets.scratch);
    gl.deleteFramebuffer(targets.maskFramebuffer);
    gl.deleteFramebuffer(targets.scratchFramebuffer);
    this.#targets = null;
    this.#horizontalPacket = null;
    this.#resolvePacket = null;
    this.#partitionResolvePacket = null;
    this.#budget.release(this.#claim);
  }

  #deleteBatchResources(): void {
    if (this.#batchBuffer !== null) this.#gl.deleteBuffer(this.#batchBuffer);
    for (const { vertexArray } of this.#batchVertexArrays.values()) {
      this.#gl.deleteVertexArray(vertexArray);
    }
    this.#batchBuffer = null;
    this.#batchCapacityBytes = 0;
    this.#batchValues = new Float32Array(0);
    this.#batchVertexArrays.clear();
    this.#budget.release(this.#batchClaim);
  }
}
