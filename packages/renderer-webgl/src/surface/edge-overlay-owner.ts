import type { LinearRgba } from "@royal/renderer-core";
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
import type { WebGlStateOwner } from "../webgl/state-owner";
import type {
  CanonicalEdgeOverlayScene,
  CanonicalEdgeSurface,
} from "./edge-overlay-scene";
import {
  frustumPlanesInto,
  worldBoundsVisible,
} from "./surface-visibility";
import type {
  BorrowedSurfaceGeometryMatch,
} from "./surface-gpu-owner";

const MASK_CLEAR: LinearRgba = [0, 0, 0, 0];
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
}`;

export const EDGE_MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in highp vec3 viewPosition;
uniform float objectId;
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
  outputMask = vec4(octEncode(normal), objectId, 1.0);
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

type MaskProgram = Readonly<{
  model: WebGLUniformLocation;
  objectId: WebGLUniformLocation;
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

type EdgePipeline = Readonly<{
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
  instanced: boolean,
): MaskProgram => {
  const program = compileProgram(
    gl,
    EDGE_MASK_VERTEX_SHADER.replace(
      "\n",
      `\n${instanced ? "#define INSTANCED\n" : ""}`,
    ),
    EDGE_MASK_FRAGMENT_SHADER,
    "edge mask",
  );
  return {
    model: requiredWebGlUniform(gl, program, "model", "edge mask"),
    objectId: requiredWebGlUniform(gl, program, "objectId", "edge mask"),
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
  ) {
    this.#budget = budget;
    this.#gl = gl;
  }

  setScene(scene: CanonicalEdgeOverlayScene | null): void {
    this.#scene = scene;
  }

  dispose(): void {
    this.#deleteTargets();
    const pipeline = this.#pipeline;
    if (pipeline !== null) {
      const gl = this.#gl;
      gl.deleteProgram(pipeline.mask.program);
      gl.deleteProgram(pipeline.instancedMask.program);
      gl.deleteProgram(pipeline.horizontal.program);
      gl.deleteProgram(pipeline.resolve.program);
      gl.deleteSampler(pipeline.sampler);
      gl.deleteVertexArray(pipeline.fullscreenVertexArray);
    }
    this.#pipeline = null;
    this.#horizontalPacket = null;
    this.#resolvePacket = null;
    this.#scene = null;
  }

  /** Drops context-invalid handles without issuing delete calls. */
  abandon(): void {
    this.#targets = null;
    this.#pipeline = null;
    this.#horizontalPacket = null;
    this.#resolvePacket = null;
    this.#horizontalBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#resolveBindings[0] = { sampler: null, target: "2d", texture: null };
    this.#budget.release(this.#claim);
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
    this.#ensurePipeline(state);
    let pending = false;
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
          borrow,
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
    borrow: (surface: CanonicalEdgeSurface) => BorrowedSurfaceGeometryMatch,
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
    let drew = false;
    let pending = false;
    for (const occurrence of run.occurrences) {
      const drawnResources = new Set<object>();
      for (const surfaceIndex of occurrence.surfaceIndices) {
        const surface = scene.surfaces[surfaceIndex]!;
        if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
        const match = borrow(surface);
        if (match.status === "absent") {
          throw new Error(
            `Royal outline glTF ${JSON.stringify(surface.asset.src)} must match `
              + "one rendered base-scene occurrence",
          );
        }
        if (match.status === "pending") {
          pending = true;
          continue;
        }
        if (match.status !== "ready") continue;
        const resource = match.resource;
        if (drawnResources.has(resource.identity)) continue;
        drawnResources.add(resource.identity);
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
        gl.uniform1f(program.objectId, occurrence.objectId / 255);
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
        drew = true;
      }
    }
    if (!drew) return { pending };

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
    state.applySurfaceDraw(this.#resolveFrame, this.#resolvePacket!);
    gl.uniform2f(pipeline.resolve.texelSize, texelX, texelY);
    gl.uniform1f(pipeline.resolve.verticalRadius, verticalRadius);
    gl.uniform4fv(pipeline.resolve.edgeColor, run.material.color);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { pending };
  }

  #ensurePipeline(state: WebGlStateOwner): void {
    if (this.#pipeline !== null) return;
    const gl = this.#gl;
    const mask = maskProgram(gl, false);
    let instancedMask: MaskProgram | undefined;
    let horizontal: HorizontalProgram | undefined;
    let resolve: ResolveProgram | undefined;
    let sampler: WebGLSampler | null = null;
    let fullscreenVertexArray: WebGLVertexArrayObject | null = null;
    try {
      instancedMask = maskProgram(gl, true);
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
      if (horizontal !== undefined) gl.deleteProgram(horizontal.program);
      if (resolve !== undefined) gl.deleteProgram(resolve.program);
      if (sampler !== null) gl.deleteSampler(sampler);
      if (fullscreenVertexArray !== null) gl.deleteVertexArray(fullscreenVertexArray);
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
    this.#budget.release(this.#claim);
  }
}
