import type { ScreenSpacePartition } from "@royal/renderer-core";
import type { SurfaceFrameView } from "../frame/surface-frame";
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
import { LINEAR_TO_SRGB_GLSL } from "../webgl/shaders/presentation-functions";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type {
  CanonicalScreenSpaceSegmentRun,
  CanonicalScreenSpaceSegmentScene,
} from "./screen-space-segment-scene";
import {
  SCREEN_SPACE_PARTITION_BUCKET_BITS,
  SCREEN_SPACE_PARTITION_PATTERN_SIZE,
  SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT,
  type ScreenSpacePartitionPatternOwner,
} from "./screen-space-partition-pattern";

const SEGMENT_VERTEX_SHADER = `#version 300 es
invariant gl_Position;
layout(location = 0) in vec3 segmentStart;
layout(location = 1) in vec3 segmentEnd;
uniform mat4 viewProjection;
uniform vec2 viewportCssSize;
uniform float widthCssPixels;
void main() {
  vec4 startClip = viewProjection * vec4(segmentStart, 1.0);
  vec4 endClip = viewProjection * vec4(segmentEnd, 1.0);
  float startNearDistance = startClip.z + startClip.w;
  float endNearDistance = endClip.z + endClip.w;
  if (startNearDistance < 0.0 && endNearDistance < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (startNearDistance < 0.0) {
    startClip = mix(
      startClip,
      endClip,
      startNearDistance / (startNearDistance - endNearDistance)
    );
  } else if (endNearDistance < 0.0) {
    endClip = mix(
      endClip,
      startClip,
      endNearDistance / (endNearDistance - startNearDistance)
    );
  }
  const float endpoint[6] = float[6](0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
  const float side[6] = float[6](-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
  float along = endpoint[gl_VertexID];
  vec4 clip = mix(startClip, endClip, along);
  vec2 startCss = startClip.xy / startClip.w * viewportCssSize * 0.5;
  vec2 endCss = endClip.xy / endClip.w * viewportCssSize * 0.5;
  vec2 delta = endCss - startCss;
  float deltaLength = length(delta);
  vec2 direction = deltaLength > 0.000001 ? delta / deltaLength : vec2(1.0, 0.0);
  vec2 perpendicular = vec2(-direction.y, direction.x);
  float halfWidth = widthCssPixels * 0.5;
  vec2 pointCss = mix(startCss, endCss, along)
    + perpendicular * side[gl_VertexID] * halfWidth
    + direction * (along * 2.0 - 1.0) * halfWidth;
  vec2 ndc = pointCss * 2.0 / viewportCssSize;
  gl_Position = vec4(ndc * clip.w, clip.z, clip.w);
}`;

const segmentFragmentShader = (partitioned: boolean): string => `#version 300 es
precision highp float;
${partitioned ? `precision highp int;
uniform vec2 partitionCellSize;
uniform int partitionCount;
uniform int partitionIndex;
uniform highp usampler2D partitionPattern;
uniform vec2 viewportOrigin;` : ""}
uniform vec4 segmentColor;
${LINEAR_TO_SRGB_GLSL}
out vec4 outputColor;
void main() {
${partitioned ? `  uvec2 cell = uvec2(floor((gl_FragCoord.xy - viewportOrigin) / partitionCellSize));
  uint bucket = texelFetch(
    partitionPattern,
    ivec2(cell & uvec2(${SCREEN_SPACE_PARTITION_PATTERN_SIZE - 1}u)),
    0
  ).r;
  if ((bucket * uint(partitionCount) >> ${SCREEN_SPACE_PARTITION_BUCKET_BITS}u)
    != uint(partitionIndex)) discard;` : ""}
  outputColor = vec4(linearToSrgb(segmentColor.rgb), segmentColor.a);
}`;

type SegmentProgram = Readonly<{
  color: WebGLUniformLocation;
  partition: Readonly<{
    cellSize: WebGLUniformLocation;
    count: WebGLUniformLocation;
    index: WebGLUniformLocation;
    viewportOrigin: WebGLUniformLocation;
  }> | null;
  program: WebGLProgram;
  viewProjection: WebGLUniformLocation;
  viewportCssSize: WebGLUniformLocation;
  widthCssPixels: WebGLUniformLocation;
}>;

type SegmentRunResource = Readonly<{
  packet: SurfaceDrawPacket;
  program: SegmentProgram;
  run: CanonicalScreenSpaceSegmentRun;
  vertexArray: WebGLVertexArrayObject;
}>;

const createProgram = (
  gl: WebGL2RenderingContext,
  partitioned: boolean,
): SegmentProgram => {
  const label = partitioned ? "partitioned screen-space segment" : "screen-space segment";
  const vertex = compileWebGlShader(gl, gl.VERTEX_SHADER, SEGMENT_VERTEX_SHADER, label);
  const fragment = compileWebGlShader(gl, gl.FRAGMENT_SHADER, segmentFragmentShader(partitioned), label);
  let program: WebGLProgram;
  try {
    program = linkWebGlProgram(gl, vertex, fragment, label);
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
  try {
    gl.useProgram(program);
    if (partitioned) {
      gl.uniform1i(
        requiredWebGlUniform(gl, program, "partitionPattern", label),
        SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT,
      );
    }
    return {
      color: requiredWebGlUniform(gl, program, "segmentColor", label),
      partition: partitioned ? {
        cellSize: requiredWebGlUniform(gl, program, "partitionCellSize", label),
        count: requiredWebGlUniform(gl, program, "partitionCount", label),
        index: requiredWebGlUniform(gl, program, "partitionIndex", label),
        viewportOrigin: requiredWebGlUniform(gl, program, "viewportOrigin", label),
      } : null,
      program,
      viewProjection: requiredWebGlUniform(gl, program, "viewProjection", label),
      viewportCssSize: requiredWebGlUniform(gl, program, "viewportCssSize", label),
      widthCssPixels: requiredWebGlUniform(gl, program, "widthCssPixels", label),
    };
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
};

/** Owns the lazy retained endpoint buffer and instanced overlay segment draws. */
export class ScreenSpaceSegmentOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  readonly #frame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  readonly #gl: WebGL2RenderingContext;
  readonly #partitionBindings: TextureUnitBinding[] = [];
  readonly #partitionPattern: ScreenSpacePartitionPatternOwner;
  #ordinaryProgram: SegmentProgram | null = null;
  #partitionProgram: SegmentProgram | null = null;
  #scene: CanonicalScreenSpaceSegmentScene | null = null;
  #uploadedScene: CanonicalScreenSpaceSegmentScene | null = null;
  #buffer: WebGLBuffer | null = null;
  #runs: readonly SegmentRunResource[] = [];

  constructor(
    gl: WebGL2RenderingContext,
    budget: PersistentGpuBudgetOwner,
    partitionPattern: ScreenSpacePartitionPatternOwner,
  ) {
    this.#budget = budget;
    this.#gl = gl;
    this.#partitionPattern = partitionPattern;
  }

  setScene(scene: CanonicalScreenSpaceSegmentScene | null): void {
    this.#scene = scene;
    if (scene === null || scene.endpoints.length === 0) this.#deleteSceneResources();
  }

  drawViews(
    views: readonly SurfaceFrameView[],
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    cssScaleX = 1,
    cssScaleY = 1,
  ): void {
    const scene = this.#scene;
    if (scene === null || scene.endpoints.length === 0) return;
    this.#ensureScene(scene, state);
    const gl = this.#gl;
    this.#frame.framebuffer = framebuffer;
    for (const view of views) {
      this.#frame.viewport = view.viewport;
      for (const resource of this.#runs) {
        state.applySurfaceDraw(this.#frame, resource.packet);
        const { material } = resource.run;
        const program = resource.program;
        gl.uniformMatrix4fv(program.viewProjection, false, view.viewProjection);
        gl.uniform2f(
          program.viewportCssSize,
          view.viewport.width / cssScaleX,
          view.viewport.height / cssScaleY,
        );
        gl.uniform1f(program.widthCssPixels, material.widthCssPixels);
        gl.uniform4fv(program.color, material.color);
        if (program.partition !== null) {
          this.#applyPartition(
            program.partition,
            material.coverage!,
            view,
            cssScaleX,
            cssScaleY,
          );
        }
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, resource.run.count);
      }
    }
  }

  dispose(): void {
    this.#deleteSceneResources();
    if (this.#ordinaryProgram !== null) this.#gl.deleteProgram(this.#ordinaryProgram.program);
    if (this.#partitionProgram !== null) this.#gl.deleteProgram(this.#partitionProgram.program);
    this.#ordinaryProgram = null;
    this.#partitionProgram = null;
    this.#scene = null;
  }

  /** Drops context-invalid handles without issuing delete calls. */
  abandon(): void {
    this.#buffer = null;
    this.#runs = [];
    this.#ordinaryProgram = null;
    this.#partitionProgram = null;
    this.#uploadedScene = null;
    this.#budget.release(this.#claim);
  }

  #applyPartition(
    program: NonNullable<SegmentProgram["partition"]>,
    coverage: ScreenSpacePartition,
    view: SurfaceFrameView,
    cssScaleX: number,
    cssScaleY: number,
  ): void {
    const gl = this.#gl;
    gl.uniform2f(
      program.cellSize,
      coverage.cellSizeCssPixels * cssScaleX,
      coverage.cellSizeCssPixels * cssScaleY,
    );
    gl.uniform1i(program.count, coverage.count);
    gl.uniform1i(program.index, coverage.index);
    gl.uniform2f(program.viewportOrigin, view.viewport.x, view.viewport.y);
  }

  #ensureScene(scene: CanonicalScreenSpaceSegmentScene, state: WebGlStateOwner): void {
    if (this.#uploadedScene === scene) return;
    this.#deleteSceneResources();
    state.invalidateVertexArray();
    const gl = this.#gl;
    const byteLength = scene.endpoints.byteLength;
    if (!this.#budget.tryClaim(this.#claim, byteLength)) {
      throw new Error("Royal persistent GPU budget denied screen-space segment endpoints");
    }
    const buffer = gl.createBuffer();
    if (buffer === null) {
      this.#budget.release(this.#claim);
      throw new Error("Royal could not allocate screen-space segment endpoints");
    }
    const runResources: SegmentRunResource[] = [];
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, scene.endpoints, gl.STATIC_DRAW);
      for (const run of scene.runs) {
        const partitioned = run.material.coverage !== undefined;
        const program = this.#ensureProgram(partitioned);
        if (partitioned) {
          this.#partitionPattern.ensure();
          this.#partitionBindings[SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT] =
            this.#partitionPattern.binding;
        }
        const vertexArray = gl.createVertexArray();
        if (vertexArray === null) throw new Error("Royal could not allocate a segment vertex array");
        try {
          gl.bindVertexArray(vertexArray);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          const byteOffset = run.first * 6 * 4;
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 6 * 4, byteOffset);
          gl.vertexAttribDivisor(0, 1);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 6 * 4, byteOffset + 3 * 4);
          gl.vertexAttribDivisor(1, 1);
          runResources.push({
            packet: {
              alphaBlend: true,
              colorWrite: true,
              cullBackFaces: false,
              depthTest: false,
              depthWrite: false,
              frontFace: gl.CCW,
              program: program.program,
              textureBindings: partitioned ? this.#partitionBindings : [],
              textureUnits: partitioned
                ? 1 << SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT
                : 0,
              vertexArray,
            },
            program,
            run,
            vertexArray,
          });
        } catch (error) {
          gl.deleteVertexArray(vertexArray);
          throw error;
        }
      }
      this.#buffer = buffer;
      this.#runs = runResources;
      this.#uploadedScene = scene;
    } catch (error) {
      for (const resource of runResources) gl.deleteVertexArray(resource.vertexArray);
      gl.deleteBuffer(buffer);
      this.#budget.release(this.#claim);
      throw error;
    } finally {
      state.invalidate();
    }
  }

  #ensureProgram(partitioned: boolean): SegmentProgram {
    if (partitioned) return this.#partitionProgram ??= createProgram(this.#gl, true);
    return this.#ordinaryProgram ??= createProgram(this.#gl, false);
  }

  #deleteSceneResources(): void {
    const gl = this.#gl;
    for (const resource of this.#runs) gl.deleteVertexArray(resource.vertexArray);
    if (this.#buffer !== null) gl.deleteBuffer(this.#buffer);
    this.#runs = [];
    this.#buffer = null;
    this.#uploadedScene = null;
    this.#budget.release(this.#claim);
  }
}
