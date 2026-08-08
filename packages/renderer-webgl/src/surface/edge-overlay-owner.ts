import type { LinearRgba } from "@royal/renderer-core";
import type { MutableClearFrameIntent } from "../frame/clear-frame";
import type { SurfaceFrameView } from "../frame/surface-frame";
import { identityMat4, mat4ValuesEqual } from "../math/mat4";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import {
  geometryBatchLayoutByteLength,
  planGeometryBatch,
  planGeometryBatchLayout,
} from "./geometry-batch-plan";
import {
  createProjectedBoundsWorkspace,
  projectedBoundsScreenExtentsInto,
} from "./lod-selection";
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
const NO_TEXTURE_BINDINGS: readonly TextureUnitBinding[] = [];
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
vec3 coveredNormal(vec4 sampleValue) {
  return sampleValue.a > 0.5 ? octDecode(sampleValue.rg) : vec3(0.0);
}
float edgeSeed(vec4 center, vec3 centerNormal, vec4 neighbor, vec3 neighborNormal) {
  bool centerCovered = center.a > 0.5;
  bool neighborCovered = neighbor.a > 0.5;
  if (centerCovered != neighborCovered) return centerCovered ? 1.0 : 0.0;
  if (!centerCovered) return 0.0;
  if (abs(center.b - neighbor.b) > (0.5 / 255.0)) {
    return center.b < neighbor.b ? 1.0 : 0.0;
  }
  if (dot(centerNormal, neighborNormal) >= ${CREASE_NORMAL_COSINE}) {
    return 0.0;
  }
  if (abs(center.r - neighbor.r) > (0.5 / 255.0)) {
    return center.r < neighbor.r ? 1.0 : 0.0;
  }
  return center.g < neighbor.g ? 1.0 : 0.0;
}
void main() {
  float signal = 0.0;
  int radius = int(ceil(horizontalRadius));
  vec2 horizontalStep = vec2(texelSize.x, 0.0);
  vec2 verticalStep = vec2(0.0, texelSize.y);
  vec2 coordinate = textureCoordinate - float(radius) * horizontalStep;
  vec4 left = texture(edgeMask, coordinate - horizontalStep);
  vec3 leftNormal = coveredNormal(left);
  vec4 center = texture(edgeMask, coordinate);
  vec3 centerNormal = coveredNormal(center);
  for (int index = 0; index <= radius * 2; index += 1) {
    vec4 right = texture(edgeMask, coordinate + horizontalStep);
    vec3 rightNormal = coveredNormal(right);
    vec4 up = texture(edgeMask, coordinate + verticalStep);
    vec4 down = texture(edgeMask, coordinate - verticalStep);
    float edge = edgeSeed(center, centerNormal, right, rightNormal);
    edge = max(edge, edgeSeed(center, centerNormal, left, leftNormal));
    edge = max(edge, edgeSeed(center, centerNormal, up, coveredNormal(up)));
    edge = max(edge, edgeSeed(center, centerNormal, down, coveredNormal(down)));
    signal = max(signal, edge);
    left = center;
    leftNormal = centerNormal;
    center = right;
    centerNormal = rightNormal;
    coordinate += horizontalStep;
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
  // The source is binary. Linear samples halfway between adjacent texels are
  // therefore an exact OR after the final threshold, halving the fetches.
  for (int offset = -radius; offset < radius; offset += 2) {
    signal = max(
      signal,
      texture(
        horizontalSignal,
        textureCoordinate + vec2(0.0, (float(offset) + 0.5) * texelSize.y)
      ).r
    );
  }
  signal = max(
    signal,
    texture(
      horizontalSignal,
      textureCoordinate + vec2(0.0, float(radius) * texelSize.y)
    ).r
  );
  signal = signal > 0.0 ? 1.0 : 0.0;
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
  for (int offset = -radius; offset < radius; offset += 2) {
    signal = max(
      signal,
      texture(
        horizontalSignal,
        textureCoordinate + vec2(0.0, (float(offset) + 0.5) * texelSize.y)
      ).r
    );
  }
  signal = max(
    signal,
    texture(
      horizontalSignal,
      textureCoordinate + vec2(0.0, float(radius) * texelSize.y)
    ).r
  );
  signal = signal > 0.0 ? 1.0 : 0.0;
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
  fullscreenVertexArray: WebGLVertexArrayObject;
  horizontal: HorizontalProgram;
  instancedMask: MaskProgram;
  mask: MaskProgram;
  maskSampler: WebGLSampler;
  resolve: ResolveProgram;
  signalSampler: WebGLSampler;
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

type MutablePixelRegion = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const updatePixelRegion = (
  output: MutablePixelRegion,
  extents: Float64Array,
  width: number,
  height: number,
  paddingX: number,
  paddingY: number,
  originX = 0,
  originY = 0,
): void => {
  const x = Math.min(width - 1, Math.max(
    0,
    Math.floor(extents[0]! * width) - paddingX,
  ));
  const y = Math.min(height - 1, Math.max(
    0,
    Math.floor(extents[1]! * height) - paddingY,
  ));
  const maximumX = Math.max(
    x + 1,
    Math.min(width, Math.ceil(extents[2]! * width) + paddingX),
  );
  const maximumY = Math.max(
    y + 1,
    Math.min(height, Math.ceil(extents[3]! * height) + paddingY),
  );
  output.x = originX + x;
  output.y = originY + y;
  output.width = maximumX - x;
  output.height = maximumY - y;
};

type ReadyBorrowedGeometry = Extract<
  BorrowedSurfaceGeometryMatch,
  { status: "ready" }
>["resource"];
type ReadyBorrowedGeometryAllocation = ReadyBorrowedGeometry["geometry"];

export type EdgeMaskDraw = Readonly<{
  objectId: number;
  resource: ReadyBorrowedGeometry;
  surface: CanonicalEdgeSurface;
}>;

export type EdgeMaskBatch = Readonly<{
  combinedDraws?: readonly EdgeMaskDraw[];
  draws: EdgeMaskDraw[];
  fallbackDraws: readonly EdgeMaskDraw[];
  geometry: ReadyBorrowedGeometryAllocation;
}>;

export type EdgeMaskPlan = Readonly<{
  batches: readonly EdgeMaskBatch[];
  pending: boolean;
}>;

type PreparedEdgeMaskBatch = {
  byteOffset: number;
  geometry: ReadyBorrowedGeometryAllocation;
  instanceCount: number;
};

type OwnedCombinedGeometry = Readonly<{
  byteLength: number;
  geometry: ReadyBorrowedGeometryAllocation;
  identities: readonly object[];
}>;

type CombinedGeometryUpload = Readonly<{
  byteLength: number;
  draws: readonly EdgeMaskDraw[];
  indexBytes: 1 | 2 | 4;
  indices: Uint8Array | Uint16Array | Uint32Array;
  positions: Float32Array;
}>;

type CombinedGeometryPlan = Readonly<{
  byteLength: number;
  draws: readonly EdgeMaskDraw[];
}>;

const sameDrawGeometrySequence = (
  left: readonly EdgeMaskDraw[],
  right: readonly EdgeMaskDraw[],
): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]!.resource.geometry.identity !== right[index]!.resource.geometry.identity) {
      return false;
    }
  }
  return true;
};

const sameGeometrySequence = (
  resource: OwnedCombinedGeometry,
  draws: readonly EdgeMaskDraw[],
): boolean => {
  if (resource.identities.length !== draws.length) return false;
  for (let index = 0; index < draws.length; index += 1) {
    if (resource.identities[index] !== draws[index]!.resource.geometry.identity) return false;
  }
  return true;
};

const matchingCombinedGeometry = (
  resources: readonly OwnedCombinedGeometry[],
  draws: readonly EdgeMaskDraw[],
): OwnedCombinedGeometry | undefined => {
  for (const resource of resources) {
    if (sameGeometrySequence(resource, draws)) return resource;
  }
  return undefined;
};

const hasMatchingUploadPlan = (
  plans: readonly CombinedGeometryPlan[],
  draws: readonly EdgeMaskDraw[],
): boolean => {
  for (const plan of plans) {
    if (sameDrawGeometrySequence(plan.draws, draws)) return true;
  }
  return false;
};

type PlannedOccurrence = Readonly<{
  draws: readonly EdgeMaskDraw[];
}>;

const combinableOccurrence = (draws: readonly EdgeMaskDraw[]): boolean => {
  const first = draws[0]!;
  return first.resource.instanceCount === 0 && draws.every(({ resource, surface }) =>
    resource.instanceCount === 0
    && surface.modelHandedness === first.surface.modelHandedness
    && mat4ValuesEqual(surface.model, first.surface.model));
};

const compatibleOccurrence = (
  left: PlannedOccurrence,
  right: PlannedOccurrence,
): boolean => {
  if (left.draws.length !== right.draws.length) return false;
  for (let index = 0; index < left.draws.length; index += 1) {
    const leftDraw = left.draws[index]!;
    const rightDraw = right.draws[index]!;
    if (
      leftDraw.resource.instanceCount > 0
      || rightDraw.resource.instanceCount > 0
      || leftDraw.resource.geometry.identity !== rightDraw.resource.geometry.identity
      || leftDraw.surface.modelHandedness !== rightDraw.surface.modelHandedness
    ) return false;
  }
  return true;
};

/**
 * Repeats a complete compatible primitive sequence occurrence-major when its
 * primitives share one model and handedness. Everything else retains authored
 * order as ordinary draws.
 */
export const planEdgeMaskBatches = (
  scene: CanonicalEdgeOverlayScene,
  run: CanonicalEdgeOverlayScene["runs"][number],
  matches: readonly BorrowedSurfaceGeometryMatch[],
  visible?: (surface: CanonicalEdgeSurface) => boolean,
): EdgeMaskPlan => {
  const batches: EdgeMaskBatch[] = [];
  let block: PlannedOccurrence[] = [];
  const flush = (): void => {
    if (block.length === 0) return;
    if (
      block.length > 1
      && block.every((occurrence) => combinableOccurrence(occurrence.draws))
    ) {
      const draws = block.map((occurrence) => occurrence.draws[0]!);
      batches.push({
        ...(block[0]!.draws.length > 1 ? { combinedDraws: block[0]!.draws } : {}),
        draws,
        fallbackDraws: block.flatMap((occurrence) => occurrence.draws),
        geometry: draws[0]!.resource.geometry,
      });
      block = [];
      return;
    }
    for (const occurrence of block) {
      for (const draw of occurrence.draws) {
        batches.push({
          draws: [draw],
          fallbackDraws: [draw],
          geometry: draw.resource.geometry,
        });
      }
    }
    block = [];
  };
  let pending = false;
  for (const occurrence of run.occurrences) {
    const draws: EdgeMaskDraw[] = [];
    const drawnResources = new Set<object>();
    for (const surfaceIndex of occurrence.surfaceIndices) {
      const surface = scene.surfaces[surfaceIndex]!;
      if (visible !== undefined && !visible(surface)) continue;
      const match = matches[surfaceIndex]!;
      if (match.status === "pending") {
        pending = true;
        continue;
      }
      if (match.status !== "ready" || drawnResources.has(match.resource.identity)) {
        continue;
      }
      drawnResources.add(match.resource.identity);
      draws.push({
        objectId: occurrence.objectId,
        resource: match.resource,
        surface,
      });
    }
    if (draws.length === 0) continue;
    const planned = { draws };
    if (
      block.length !== 0
      && !compatibleOccurrence(block[0]!, planned)
    ) {
      flush();
    }
    block.push(planned);
  }
  flush();
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
  try {
    return {
      model: requiredWebGlUniform(gl, program, "model", "edge mask"),
      ...(batched
        ? {}
        : { objectId: requiredWebGlUniform(gl, program, "objectId", "edge mask") }),
      program,
      view: requiredWebGlUniform(gl, program, "view", "edge mask"),
      viewProjection: requiredWebGlUniform(gl, program, "viewProjection", "edge mask"),
    };
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
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
  readonly #batchClaim = {};
  #batchDisabled = false;
  readonly #batchGeometryIdentities = new Set<object>();
  readonly #batchOffsets = new Map<EdgeMaskBatch, number>();
  readonly #batchVisibleDraws = new Set<EdgeMaskDraw>();
  #batchProgram: MaskProgram | null = null;
  #batchRetainedBytes = 0;
  #batchValues = new Float32Array(0);
  readonly #batchVertexArrays = new Map<
    object,
    { byteOffset: number; vertexArray: WebGLVertexArrayObject }
  >();
  readonly #combinedGeometryClaims = new Set<OwnedCombinedGeometry>();
  #combinedGeometries: OwnedCombinedGeometry[] = [];
  readonly #clearIntent: MutableClearFrameIntent = {
    clearColor: MASK_CLEAR,
    clearDepth: 1,
    framebuffer: null,
    scissor: null,
    size: { height: 1, width: 1 },
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  readonly #discardDepthAttachment: number[];
  readonly #frustumPlanes = new Float32Array(24);
  readonly #gl: WebGL2RenderingContext;
  #horizontalRestricted = false;
  readonly #horizontalBindings: TextureUnitBinding[] = [{
    sampler: null,
    target: "2d",
    texture: null,
  }];
  readonly #horizontalFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: this.#clearIntent.viewport,
  };
  #horizontalPacket: SurfaceDrawPacket | null = null;
  readonly #maskFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: this.#clearIntent.viewport,
  };
  #maskDrawPacket: {
    alphaBlend: boolean;
    colorWrite: boolean;
    cullBackFaces: boolean;
    depthTest: boolean;
    depthWrite: boolean;
    frontFace: number;
    program: WebGLProgram;
    textureBindings: readonly TextureUnitBinding[];
    textureUnits: number;
    vertexArray: WebGLVertexArrayObject;
  } | null = null;
  #pipeline: EdgePipeline | null = null;
  #plannedMatches: (object | BorrowedSurfaceGeometryMatch["status"])[] = [];
  #plannedScene: CanonicalEdgeOverlayScene | null = null;
  #plans: readonly EdgeMaskPlan[] = [];
  readonly #preparedBatches = new Map<EdgeMaskBatch, PreparedEdgeMaskBatch>();
  #partitionResolve: PartitionResolveProgram | null = null;
  readonly #partitionResolveBindings: TextureUnitBinding[] = [
    { sampler: null, target: "2d", texture: null },
    { sampler: null, target: "2d", texture: null },
  ];
  #partitionResolvePacket: SurfaceDrawPacket | null = null;
  readonly #partitionPattern: ScreenSpacePartitionPatternOwner;
  readonly #projectedBounds = createProjectedBoundsWorkspace();
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
  #resolveRestricted = false;
  #scene: CanonicalEdgeOverlayScene | null = null;
  readonly #surfaceMatches: BorrowedSurfaceGeometryMatch[] = [];
  readonly #uploadPlans: CombinedGeometryPlan[] = [];
  readonly #viewFrustumPlanes: Float32Array[] = [];
  readonly #screenExtents = new Float64Array(4);
  readonly #scratchClearScissor: MutablePixelRegion = { height: 1, width: 1, x: 0, y: 0 };
  readonly #horizontalScissor: MutablePixelRegion = { height: 1, width: 1, x: 0, y: 0 };
  readonly #resolveScissor: MutablePixelRegion = { height: 1, width: 1, x: 0, y: 0 };
  #targets: EdgeTargets | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    budget: PersistentGpuBudgetOwner,
    partitionPattern: ScreenSpacePartitionPatternOwner,
  ) {
    this.#budget = budget;
    this.#discardDepthAttachment = [gl.DEPTH_ATTACHMENT];
    this.#gl = gl;
    this.#partitionPattern = partitionPattern;
  }

  setScene(scene: CanonicalEdgeOverlayScene | null): void {
    if (this.#scene !== scene) {
      this.#plannedMatches.length = 0;
      this.#plannedScene = null;
      this.#plans = [];
    }
    this.#scene = scene;
    if (scene === null || scene.runs.length === 0) this.#deleteBatchResources();
  }

  dispose(): void {
    this.#deleteTargets();
    this.#deleteBatchResources();
    const pipeline = this.#pipeline;
    if (pipeline !== null) {
      const gl = this.#gl;
      gl.deleteProgram(pipeline.mask.program);
      gl.deleteProgram(pipeline.instancedMask.program);
      gl.deleteProgram(pipeline.horizontal.program);
      gl.deleteProgram(pipeline.resolve.program);
      gl.deleteSampler(pipeline.maskSampler);
      gl.deleteSampler(pipeline.signalSampler);
      gl.deleteVertexArray(pipeline.fullscreenVertexArray);
    }
    if (this.#batchProgram !== null) this.#gl.deleteProgram(this.#batchProgram.program);
    if (this.#partitionResolve !== null) {
      this.#gl.deleteProgram(this.#partitionResolve.program);
    }
    this.#pipeline = null;
    this.#batchProgram = null;
    this.#partitionResolve = null;
    this.#partitionResolvePacket = null;
    this.#horizontalPacket = null;
    this.#resolvePacket = null;
    this.#scene = null;
  }

  /** Drops context-invalid handles without issuing delete calls. */
  abandon(): void {
    this.#batchBuffer = null;
    this.#batchDisabled = false;
    this.#batchProgram = null;
    this.#batchRetainedBytes = 0;
    this.#batchGeometryIdentities.clear();
    this.#batchOffsets.clear();
    this.#batchVisibleDraws.clear();
    this.#batchVertexArrays.clear();
    this.#combinedGeometries.length = 0;
    this.#combinedGeometryClaims.clear();
    this.#preparedBatches.clear();
    this.#uploadPlans.length = 0;
    this.#targets = null;
    this.#pipeline = null;
    this.#partitionResolve = null;
    this.#partitionResolvePacket = null;
    this.#horizontalPacket = null;
    this.#maskDrawPacket = null;
    this.#resolvePacket = null;
    this.#clearIntent.framebuffer = null;
    this.#horizontalFrame.framebuffer = null;
    this.#maskFrame.framebuffer = null;
    this.#plannedMatches.length = 0;
    this.#plannedScene = null;
    this.#plans = [];
    this.#surfaceMatches.length = 0;
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
    this.#ensurePipeline(state);
    for (const run of scene.runs) {
      if (run.material.coverage === undefined) continue;
      this.#ensurePartitionResolve(state);
      break;
    }
    const plans = this.#plansFor(scene, matches);
    let maximumTargetBytes = 0;
    for (const view of views) {
      maximumTargetBytes = Math.max(
        maximumTargetBytes,
        view.viewport.width * view.viewport.height * 9,
      );
    }
    const batchOffsets = this.#prepareBatches(plans, views, state, maximumTargetBytes);
    let pending = false;
    for (const plan of plans) pending ||= plan.pending;
    for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
      const view = views[viewIndex]!;
      if (!this.#ensureTargets(view.viewport.width, view.viewport.height, state)) continue;
      frustumPlanesInto(this.#frustumPlanes, view.viewProjection);
      for (let runIndex = 0; runIndex < scene.runs.length; runIndex += 1) {
        this.#drawRun(
          scene.runs[runIndex]!,
          plans[runIndex]!,
          view,
          framebuffer,
          state,
          cssScaleX,
          cssScaleY,
          batchOffsets,
        );
      }
    }
    return pending;
  }

  #drawRun(
    run: CanonicalEdgeOverlayScene["runs"][number],
    plan: EdgeMaskPlan,
    view: SurfaceFrameView,
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    cssScaleX: number,
    cssScaleY: number,
    preparedBatches: ReadonlyMap<EdgeMaskBatch, PreparedEdgeMaskBatch> | undefined,
  ): void {
    const targets = this.#targets!;
    const pipeline = this.#pipeline!;
    const gl = this.#gl;
    state.unbindTextureUnit(0);
    this.#clearIntent.framebuffer = targets.maskFramebuffer;
    this.#clearIntent.scissor = null;
    this.#clearIntent.size.height = targets.height;
    this.#clearIntent.size.width = targets.width;
    this.#clearIntent.viewport.height = targets.height;
    this.#clearIntent.viewport.width = targets.width;
    this.#clearIntent.viewport.x = 0;
    this.#clearIntent.viewport.y = 0;
    state.clear(this.#clearIntent);
    this.#maskFrame.framebuffer = targets.maskFramebuffer;
    let drew = false;
    for (const batch of plan.batches) {
      let batchVisible = false;
      for (const { surface } of batch.fallbackDraws) {
        if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
        batchVisible = true;
        break;
      }
      if (!batchVisible) continue;
      const prepared = preparedBatches?.get(batch);
      if (batch.draws.length > 1 && prepared !== undefined) {
        this.#drawBatch(batch, prepared, view, state);
        drew = true;
      } else {
        for (const { objectId, resource: drawResource, surface } of batch.fallbackDraws) {
          if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
          const program = drawResource.instanceCount > 0
            ? pipeline.instancedMask
            : pipeline.mask;
          this.#applyMaskDraw(
            state,
            program.program,
            drawResource.vertexArray,
            surface.modelHandedness < 0 ? gl.CW : gl.CCW,
          );
          gl.uniformMatrix4fv(program.view, false, view.view);
          gl.uniformMatrix4fv(program.viewProjection, false, view.viewProjection);
          gl.uniformMatrix4fv(program.model, false, surface.model);
          gl.uniform1f(program.objectId!, objectId / 255);
          if (drawResource.instanceCount > 0) {
            gl.drawElementsInstanced(
              gl.TRIANGLES,
              drawResource.geometry.indexCount,
              drawResource.geometry.indexType,
              drawResource.geometry.indexOffset,
              drawResource.instanceCount,
            );
          } else {
            gl.drawElements(
              gl.TRIANGLES,
              drawResource.geometry.indexCount,
              drawResource.geometry.indexType,
              drawResource.geometry.indexOffset,
            );
          }
          drew = true;
        }
      }
    }
    if (!drew) return;
    // The mask depth is needed only while rasterizing this run. Discard it
    // before switching targets so tiled GPUs do not store a full-screen depth
    // attachment which no later pass samples.
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, this.#discardDepthAttachment);

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
    this.#updatePassScissors(plan, view, horizontalRadius, verticalRadius);
    if (this.#horizontalRestricted) {
      this.#clearIntent.framebuffer = targets.scratchFramebuffer;
      this.#clearIntent.scissor = this.#scratchClearScissor;
      state.clear(this.#clearIntent);
    }
    this.#horizontalFrame.framebuffer = targets.scratchFramebuffer;
    state.applySurfaceDraw(this.#horizontalFrame, this.#horizontalPacket!);
    if (this.#horizontalRestricted) state.applyDrawScissor(this.#horizontalScissor);
    gl.uniform2f(pipeline.horizontal.texelSize, texelX, texelY);
    gl.uniform1f(pipeline.horizontal.horizontalRadius, horizontalRadius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.#resolveFrame.framebuffer = framebuffer;
    this.#resolveFrame.viewport = view.viewport;
    const coverage = run.material.coverage;
    if (coverage === undefined) {
      state.applySurfaceDraw(this.#resolveFrame, this.#resolvePacket!);
      if (this.#resolveRestricted) state.applyDrawScissor(this.#resolveScissor);
      gl.uniform2f(pipeline.resolve.texelSize, texelX, texelY);
      gl.uniform1f(pipeline.resolve.verticalRadius, verticalRadius);
      gl.uniform4fv(pipeline.resolve.edgeColor, run.material.color);
    } else {
      const resolve = this.#partitionResolve!;
      state.applySurfaceDraw(this.#resolveFrame, this.#partitionResolvePacket!);
      if (this.#resolveRestricted) state.applyDrawScissor(this.#resolveScissor);
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
  }

  #updatePassScissors(
    plan: EdgeMaskPlan,
    view: SurfaceFrameView,
    horizontalRadius: number,
    verticalRadius: number,
  ): void {
    const extents = this.#screenExtents;
    extents[0] = 1;
    extents[1] = 1;
    extents[2] = 0;
    extents[3] = 0;
    let projected = false;
    for (const batch of plan.batches) {
      for (const { surface } of batch.fallbackDraws) {
        if (!projectedBoundsScreenExtentsInto(
          surface.worldBounds,
          view.viewProjection,
          this.#projectedBounds,
        )) continue;
        const candidate = this.#projectedBounds.screenExtents;
        extents[0] = Math.min(extents[0]!, candidate[0]!);
        extents[1] = Math.min(extents[1]!, candidate[1]!);
        extents[2] = Math.max(extents[2]!, candidate[2]!);
        extents[3] = Math.max(extents[3]!, candidate[3]!);
        projected = true;
      }
    }
    if (!projected) {
      extents[0] = 0;
      extents[1] = 0;
      extents[2] = 1;
      extents[3] = 1;
    }
    const horizontalPadding = Math.ceil(horizontalRadius) + 2;
    const verticalPadding = Math.ceil(verticalRadius) + 2;
    const targets = this.#targets!;
    updatePixelRegion(
      this.#horizontalScissor,
      extents,
      targets.width,
      targets.height,
      horizontalPadding,
      2,
    );
    updatePixelRegion(
      this.#resolveScissor,
      extents,
      targets.width,
      targets.height,
      horizontalPadding,
      verticalPadding,
      view.viewport.x,
      view.viewport.y,
    );
    updatePixelRegion(
      this.#scratchClearScissor,
      extents,
      targets.width,
      targets.height,
      horizontalPadding,
      verticalPadding + Math.ceil(verticalRadius),
    );
    this.#horizontalRestricted = this.#horizontalScissor.x !== 0
      || this.#horizontalScissor.y !== 0
      || this.#horizontalScissor.width !== targets.width
      || this.#horizontalScissor.height !== targets.height;
    this.#resolveRestricted = this.#resolveScissor.x !== view.viewport.x
      || this.#resolveScissor.y !== view.viewport.y
      || this.#resolveScissor.width !== targets.width
      || this.#resolveScissor.height !== targets.height;
  }

  #drawBatch(
    batch: EdgeMaskBatch,
    prepared: PreparedEdgeMaskBatch,
    view: SurfaceFrameView,
    state: WebGlStateOwner,
  ): void {
    const gl = this.#gl;
    const program = this.#batchProgram!;
    const { byteOffset, geometry, instanceCount } = prepared;
    const binding = this.#batchVertexArrays.get(geometry.identity)!;
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
      state.invalidate();
    }
    this.#applyMaskDraw(
      state,
      program.program,
      binding.vertexArray,
      batch.draws[0]!.surface.modelHandedness < 0 ? gl.CW : gl.CCW,
    );
    gl.uniformMatrix4fv(program.view, false, view.view);
    gl.uniformMatrix4fv(program.viewProjection, false, view.viewProjection);
    gl.uniformMatrix4fv(program.model, false, IDENTITY_MODEL);
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      geometry.indexCount,
      geometry.indexType,
      geometry.indexOffset,
      instanceCount,
    );
  }

  #prepareBatches(
    plans: readonly EdgeMaskPlan[],
    views: readonly SurfaceFrameView[],
    state: WebGlStateOwner,
    requiredTargetBytes: number,
  ): ReadonlyMap<EdgeMaskBatch, PreparedEdgeMaskBatch> | undefined {
    const offsets = this.#batchOffsets;
    offsets.clear();
    while (this.#viewFrustumPlanes.length < views.length) {
      this.#viewFrustumPlanes.push(new Float32Array(24));
    }
    for (let index = 0; index < views.length; index += 1) {
      frustumPlanesInto(this.#viewFrustumPlanes[index]!, views[index]!.viewProjection);
    }
    const visibleDraws = this.#batchVisibleDraws;
    visibleDraws.clear();
    let valueCount = 0;
    for (const plan of plans) {
      for (const batch of plan.batches) {
        if (batch.draws.length < 2) continue;
        const visibleCount = this.#retainVisibleBatchDraws(batch, views.length);
        if (visibleCount < 2) continue;
        offsets.set(batch, valueCount * Float32Array.BYTES_PER_ELEMENT);
        valueCount += visibleCount * BATCH_INSTANCE_FLOATS;
      }
    }
    if (valueCount === 0) {
      this.#deleteBatchResources();
      this.#preparedBatches.clear();
      return this.#preparedBatches;
    }
    if (this.#batchDisabled) return undefined;
    const byteLength = valueCount * Float32Array.BYTES_PER_ELEMENT;
    const uploadPlans = this.#uploadPlans;
    uploadPlans.length = 0;
    const activeCombined = this.#combinedGeometryClaims;
    activeCombined.clear();
    for (const batch of offsets.keys()) {
      const draws = batch.combinedDraws;
      if (draws === undefined) continue;
      const retained = matchingCombinedGeometry(this.#combinedGeometries, draws);
      if (retained !== undefined) {
        activeCombined.add(retained);
        continue;
      }
      if (hasMatchingUploadPlan(uploadPlans, draws)) continue;
      const layout = planGeometryBatchLayout(draws.map(({ surface }) => ({
        indices: surface.geometry.indices,
        vertexCount: surface.geometry.positions.length / 3,
      })));
      uploadPlans.push({
        byteLength: geometryBatchLayoutByteLength(layout, 3 * Float32Array.BYTES_PER_ELEMENT),
        draws,
      });
    }
    let reconciled = false;
    let retainedCombinedCount = 0;
    for (const resource of this.#combinedGeometries) {
      if (activeCombined.has(resource)) {
        this.#combinedGeometries[retainedCombinedCount] = resource;
        retainedCombinedCount += 1;
      } else {
        this.#deleteCombinedGeometry(resource);
        reconciled = true;
      }
    }
    this.#combinedGeometries.length = retainedCombinedCount;
    if (reconciled) state.invalidate();
    let combinedByteLength = 0;
    for (const resource of this.#combinedGeometries) {
      combinedByteLength += resource.byteLength;
    }
    for (const upload of uploadPlans) combinedByteLength += upload.byteLength;
    const retainedByteLength = byteLength + combinedByteLength;
    const gl = this.#gl;
    const currentTargetBytes = this.#targets === null
      ? 0
      : this.#targets.width * this.#targets.height * 9;
    if (
      retainedByteLength > this.#budget.availableBytes
        + this.#batchRetainedBytes
        + currentTargetBytes
        - requiredTargetBytes
    ) {
      this.#deleteBatchResources();
      return undefined;
    }
    if (this.#batchProgram === null) {
      try {
        this.#batchProgram = maskProgram(gl, "batched");
      } catch {
        this.#deleteBatchResources();
        this.#batchDisabled = true;
        state.invalidate();
        return undefined;
      }
    }
    if (this.#batchValues.length < valueCount) {
      this.#batchValues = new Float32Array(valueCount);
    }
    let offset = 0;
    for (const plan of plans) {
      for (const batch of plan.batches) {
        if (!offsets.has(batch)) continue;
        for (const draw of batch.draws) {
          if (!visibleDraws.has(draw)) continue;
          const { objectId, surface } = draw;
          this.#batchValues.set(surface.model, offset);
          this.#batchValues[offset + 16] = objectId / 255;
          offset += BATCH_INSTANCE_FLOATS;
        }
      }
    }
    if (this.#batchBuffer === null) {
      this.#batchBuffer = gl.createBuffer();
      if (this.#batchBuffer === null) {
        this.#deleteBatchResources();
        this.#batchDisabled = true;
        return undefined;
      }
    }
    if (!this.#budget.tryClaim(this.#batchClaim, retainedByteLength)) {
      this.#deleteBatchResources();
      return undefined;
    }
    this.#batchRetainedBytes = retainedByteLength;
    try {
      for (const uploadPlan of uploadPlans) {
        const plan = planGeometryBatch(uploadPlan.draws.map(({ surface }) => ({
          indices: surface.geometry.indices,
          vertexCount: surface.geometry.positions.length / 3,
        })));
        const positions = new Float32Array(plan.vertexCount * 3);
        let positionOffset = 0;
        for (const { surface } of uploadPlan.draws) {
          positions.set(surface.geometry.positions, positionOffset);
          positionOffset += surface.geometry.positions.length;
        }
        const upload: CombinedGeometryUpload = {
          byteLength: uploadPlan.byteLength,
          draws: uploadPlan.draws,
          indexBytes: plan.indexBytes,
          indices: plan.indices,
          positions,
        };
        const resource = this.#createCombinedGeometry(upload);
        if (resource === undefined) {
          this.#deleteBatchResources();
          this.#batchDisabled = true;
          state.invalidate();
          return undefined;
        }
        this.#combinedGeometries.push(resource);
      }
    } catch (error) {
      this.#deleteBatchResources();
      state.invalidate();
      throw error;
    }
    const prepared = this.#preparedBatches;
    for (const batch of prepared.keys()) {
      if (!offsets.has(batch)) prepared.delete(batch);
    }
    for (const [batch, byteOffset] of offsets) {
      const geometry = batch.combinedDraws === undefined
        ? batch.geometry
        : matchingCombinedGeometry(this.#combinedGeometries, batch.combinedDraws)!.geometry;
      const retained = prepared.get(batch);
      let instanceCount = 0;
      for (const draw of batch.draws) {
        if (visibleDraws.has(draw)) instanceCount += 1;
      }
      if (retained === undefined) {
        prepared.set(batch, { byteOffset, geometry, instanceCount });
      } else {
        retained.byteOffset = byteOffset;
        retained.geometry = geometry;
        retained.instanceCount = instanceCount;
      }
    }
    const activeGeometries = this.#batchGeometryIdentities;
    activeGeometries.clear();
    for (const { geometry } of prepared.values()) activeGeometries.add(geometry.identity);
    for (const [identity, { vertexArray }] of this.#batchVertexArrays) {
      if (activeGeometries.has(identity)) continue;
      gl.deleteVertexArray(vertexArray);
      this.#batchVertexArrays.delete(identity);
    }
    for (const { geometry } of prepared.values()) {
      if (this.#batchVertexArrays.has(geometry.identity)) continue;
      const vertexArray = gl.createVertexArray();
      if (vertexArray === null) {
        this.#deleteBatchResources();
        this.#batchDisabled = true;
        state.invalidate();
        return undefined;
      }
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      this.#batchVertexArrays.set(geometry.identity, { byteOffset: -1, vertexArray });
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#batchBuffer);
    // Orphan before the one packed upload so a hot overlay never waits for the
    // preceding mask draws to release this storage.
    gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#batchValues, 0, valueCount);
    state.invalidate();
    return prepared;
  }

  #applyMaskDraw(
    state: WebGlStateOwner,
    program: WebGLProgram,
    vertexArray: WebGLVertexArrayObject,
    frontFace: number,
  ): void {
    const packet = this.#maskDrawPacket ??= {
      alphaBlend: false,
      colorWrite: true,
      cullBackFaces: false,
      depthTest: true,
      depthWrite: true,
      frontFace,
      program,
      textureBindings: NO_TEXTURE_BINDINGS,
      textureUnits: 0,
      vertexArray,
    };
    packet.frontFace = frontFace;
    packet.program = program;
    packet.vertexArray = vertexArray;
    state.applySurfaceDraw(this.#maskFrame, packet);
  }

  #retainVisibleBatchDraws(
    batch: EdgeMaskBatch,
    viewCount: number,
  ): number {
    let visibleDraws = 0;
    for (const draw of batch.draws) {
      let visible = false;
      for (const candidate of batch.fallbackDraws) {
        if (candidate.objectId !== draw.objectId) continue;
        for (let viewIndex = 0; viewIndex < viewCount; viewIndex += 1) {
          if (worldBoundsVisible(
            candidate.surface.worldBounds,
            this.#viewFrustumPlanes[viewIndex]!,
          )) {
            visible = true;
            break;
          }
        }
        if (visible) break;
      }
      if (visible) {
        this.#batchVisibleDraws.add(draw);
        visibleDraws += 1;
      }
    }
    return visibleDraws;
  }

  #createCombinedGeometry(
    upload: CombinedGeometryUpload,
  ): OwnedCombinedGeometry | undefined {
    const gl = this.#gl;
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (vertexBuffer === null || indexBuffer === null) {
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      return undefined;
    }
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, upload.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, upload.indices, gl.STATIC_DRAW);
      return {
        byteLength: upload.byteLength,
        geometry: {
          identity: {},
          indexBuffer,
          indexCount: upload.indices.length,
          indexOffset: 0,
          indexType: upload.indexBytes === 4
            ? gl.UNSIGNED_INT
            : upload.indexBytes === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE,
          key: `edge:${upload.draws.map((draw) => draw.resource.geometry.key).join("|")}`,
          vertexBuffer,
        },
        identities: upload.draws.map((draw) => draw.resource.geometry.identity),
      };
    } catch (error) {
      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(indexBuffer);
      throw error;
    }
  }

  #deleteCombinedGeometry(resource: OwnedCombinedGeometry): void {
    this.#gl.deleteBuffer(resource.geometry.vertexBuffer);
    this.#gl.deleteBuffer(resource.geometry.indexBuffer);
    const binding = this.#batchVertexArrays.get(resource.geometry.identity);
    if (binding !== undefined) {
      this.#gl.deleteVertexArray(binding.vertexArray);
      this.#batchVertexArrays.delete(resource.geometry.identity);
    }
  }

  #preflight(
    scene: CanonicalEdgeOverlayScene,
    borrow: (surface: CanonicalEdgeSurface) => BorrowedSurfaceGeometryMatch,
  ): readonly BorrowedSurfaceGeometryMatch[] {
    const matches = this.#surfaceMatches;
    matches.length = scene.surfaces.length;
    for (let index = 0; index < scene.surfaces.length; index += 1) {
      const surface = scene.surfaces[index]!;
      const match = borrow(surface);
      matches[index] = match;
      if (match.status !== "absent") continue;
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
          + `transform ${sourceLabel} is missing `
          + `in the base scene; presentation transform is ${presentationLabel}`,
      );
    }
    return matches;
  }

  #plansFor(
    scene: CanonicalEdgeOverlayScene,
    matches: readonly BorrowedSurfaceGeometryMatch[],
  ): readonly EdgeMaskPlan[] {
    let changed = this.#plannedScene !== scene || this.#plannedMatches.length !== matches.length;
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]!;
      const key = match.status === "ready" ? match.resource : match.status;
      if (this.#plannedMatches[index] !== key) changed = true;
      this.#plannedMatches[index] = key;
    }
    this.#plannedMatches.length = matches.length;
    if (!changed) return this.#plans;
    this.#plannedScene = scene;
    this.#plans = scene.runs.map((run) => planEdgeMaskBatches(scene, run, matches));
    return this.#plans;
  }

  #ensurePipeline(state: WebGlStateOwner): void {
    if (this.#pipeline !== null) return;
    const gl = this.#gl;
    const mask = maskProgram(gl, "ordinary");
    let instancedMask: MaskProgram | undefined;
    let horizontal: HorizontalProgram | undefined;
    let resolve: ResolveProgram | undefined;
    let maskSampler: WebGLSampler | null = null;
    let signalSampler: WebGLSampler | null = null;
    let fullscreenVertexArray: WebGLVertexArrayObject | null = null;
    try {
      instancedMask = maskProgram(gl, "instanced");
      horizontal = horizontalProgram(gl);
      resolve = resolveProgram(gl);
      maskSampler = gl.createSampler();
      signalSampler = gl.createSampler();
      fullscreenVertexArray = gl.createVertexArray();
      if (maskSampler === null || signalSampler === null || fullscreenVertexArray === null) {
        throw new Error("Royal could not allocate the edge overlay pipeline");
      }
      gl.samplerParameteri(maskSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.samplerParameteri(maskSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.samplerParameteri(maskSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(maskSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(signalSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.samplerParameteri(signalSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.samplerParameteri(signalSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(signalSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.#pipeline = {
        fullscreenVertexArray,
        horizontal,
        instancedMask,
        mask,
        maskSampler,
        resolve,
        signalSampler,
      };
      this.#rebuildPackets();
    } catch (error) {
      gl.deleteProgram(mask.program);
      if (instancedMask !== undefined) gl.deleteProgram(instancedMask.program);
      if (horizontal !== undefined) gl.deleteProgram(horizontal.program);
      if (resolve !== undefined) gl.deleteProgram(resolve.program);
      if (maskSampler !== null) gl.deleteSampler(maskSampler);
      if (signalSampler !== null) gl.deleteSampler(signalSampler);
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
      sampler: pipeline.maskSampler,
      target: "2d",
      texture: targets.mask,
    };
    this.#resolveBindings[0] = {
      sampler: pipeline.signalSampler,
      target: "2d",
      texture: targets.scratch,
    };
    this.#partitionResolveBindings[0] = {
      sampler: pipeline.signalSampler,
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
    for (const resource of this.#combinedGeometries) {
      this.#deleteCombinedGeometry(resource);
    }
    for (const { vertexArray } of this.#batchVertexArrays.values()) {
      this.#gl.deleteVertexArray(vertexArray);
    }
    this.#batchBuffer = null;
    this.#batchRetainedBytes = 0;
    this.#batchVertexArrays.clear();
    this.#combinedGeometries.length = 0;
    this.#batchGeometryIdentities.clear();
    this.#batchOffsets.clear();
    this.#batchVisibleDraws.clear();
    this.#combinedGeometryClaims.clear();
    this.#preparedBatches.clear();
    this.#uploadPlans.length = 0;
    this.#budget.release(this.#batchClaim);
  }
}
