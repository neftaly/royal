import type { LinearRgba } from "@royal/renderer-core";
import type { FrameViewport, MutableClearFrameIntent } from "../frame/clear-frame";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type { GpuTextureBinding } from "../texture/gpu-owner";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type {
  MutableSurfaceDrawFrame,
  SurfaceDrawPacket,
} from "../webgl/draw-state-transition";
import presentationFragmentShader from "../webgl/shaders/presentation.frag";
import presentationVertexShader from "../webgl/shaders/presentation.vert";
import { PRESENTATION_GLSL } from "../webgl/shaders/presentation-functions";
import { compileWebGlShader, linkWebGlProgram } from "../webgl/program";
import {
  compositeTargetByteLength,
  transmissionSceneColorMaxLod,
  transmissionSceneColorMipLevels,
} from "./surface-composite-plan";
import type { SurfaceTransmissionShaderSource } from "./surface-program-owner";
import {
  linearCompositeColorBytesPerPixel,
  type LinearCompositeCapabilities,
} from "./terminal-presentation-plan";

export const transmissionShaderSource: SurfaceTransmissionShaderSource = {
  fragmentDeclarations: `
#ifdef TRANSMISSION_MATERIAL
uniform sampler2D sceneColor;
uniform vec4 transmissionFactors;
#ifdef VOLUME_MATERIAL
uniform vec4 attenuationColor;
uniform mat4 viewProjection;
#endif
#endif
#ifdef TRANSMISSION_TEXTURED
#ifndef IDENTITY_TEXTURE_COORDINATES
in vec2 surfaceTransmissionTextureCoordinate;
#endif
uniform sampler2D transmissionTexture;
#endif
#ifdef THICKNESS_TEXTURED
#ifndef IDENTITY_TEXTURE_COORDINATES
in vec2 surfaceThicknessTextureCoordinate;
#endif
uniform sampler2D thicknessTexture;
#endif
`,
  fragmentBody: `
#ifdef TRANSMISSION_MATERIAL
  float transmission = transmissionFactors.x;
#ifdef TRANSMISSION_TEXTURED
  transmission *= texture(transmissionTexture, surfaceTransmissionTextureCoordinate).r;
#endif
  vec2 sourceCoordinate = gl_FragCoord.xy / vec2(textureSize(sceneColor, 0));
#ifdef VOLUME_MATERIAL
  float thickness = transmissionFactors.y;
#ifdef THICKNESS_TEXTURED
  thickness *= texture(thicknessTexture, surfaceThicknessTextureCoordinate).g;
#endif
  float ior = transmissionFactors.z > 0.0 ? transmissionFactors.z : 1.0;
  vec3 refractionDirection = refract(-viewDirection, normal, 1.0 / ior);
  float transmissionDistance = thickness / max(abs(dot(normal, refractionDirection)), 0.05);
  vec4 exitClip = viewProjection * vec4(
    worldPosition + refractionDirection * transmissionDistance,
    1.0
  );
  vec2 sampleCoordinate = exitClip.xy / max(abs(exitClip.w), 0.000001) * 0.5 + 0.5;
  bool sourceAvailable = exitClip.w > 0.0
    && all(greaterThanEqual(sampleCoordinate, vec2(0.0)))
    && all(lessThanEqual(sampleCoordinate, vec2(1.0)));
#endif
  float sourceLod = roughness * transmissionFactors.w;
#ifdef VOLUME_MATERIAL
  vec3 transmitted = sourceAvailable
    ? textureLod(sceneColor, sampleCoordinate, sourceLod).rgb * surfaceBaseColor.rgb
    : linear;
#else
  vec3 transmitted = textureLod(sceneColor, sourceCoordinate, sourceLod).rgb
    * surfaceBaseColor.rgb;
#endif
#ifdef VOLUME_MATERIAL
  if (sourceAvailable && attenuationColor.a > 0.0) {
    transmitted *= pow(
      max(attenuationColor.rgb, vec3(0.000001)),
      vec3(transmissionDistance * attenuationColor.a)
    );
  }
#endif
  vec3 viewFresnel = mix(f0, f90, fresnelPower(normalView));
  float transmissionWeight = transmission
    * (1.0 - metallic)
    * (1.0 - max(viewFresnel.r, max(viewFresnel.g, viewFresnel.b)));
  linear = mix(linear, transmitted, clamp(transmissionWeight, 0.0, 1.0));
#endif
`,
  vertexDeclarations: `
#ifdef TRANSMISSION_TEXTURED
#ifndef IDENTITY_TEXTURE_COORDINATES
uniform vec4 transmissionTextureCoordinates0;
uniform vec4 transmissionTextureCoordinates1;
out vec2 surfaceTransmissionTextureCoordinate;
#endif
#endif
#ifdef THICKNESS_TEXTURED
#ifndef IDENTITY_TEXTURE_COORDINATES
uniform vec4 thicknessTextureCoordinates0;
uniform vec4 thicknessTextureCoordinates1;
out vec2 surfaceThicknessTextureCoordinate;
#endif
#endif
`,
  vertexBody: `
#ifdef TRANSMISSION_TEXTURED
#ifndef IDENTITY_TEXTURE_COORDINATES
  surfaceTransmissionTextureCoordinate = transformedTextureCoordinate(
    transmissionTextureCoordinates0,
    transmissionTextureCoordinates1
  );
#endif
#endif
#ifdef THICKNESS_TEXTURED
#ifndef IDENTITY_TEXTURE_COORDINATES
  surfaceThicknessTextureCoordinate = transformedTextureCoordinate(
    thicknessTextureCoordinates0,
    thicknessTextureCoordinates1
  );
#endif
#endif
`,
};

type CompositeResources = Readonly<{
  color: WebGLTexture;
  colorBytesPerPixel: 4 | 8;
  depth: WebGLRenderbuffer;
  framebuffer: WebGLFramebuffer;
  height: number;
  sceneColor: WebGLTexture | null;
  sceneColorLevels: number;
  width: number;
}>;

const PRESENTATION_FRAGMENT_SHADER = presentationFragmentShader.replace(
  "__PRESENTATION_FUNCTIONS__",
  PRESENTATION_GLSL,
);

const createProgram = (gl: WebGL2RenderingContext): WebGLProgram => {
  const vertex = compileWebGlShader(
    gl,
    gl.VERTEX_SHADER,
    presentationVertexShader,
    "presentation",
  );
  let fragment: WebGLShader;
  try {
    fragment = compileWebGlShader(
      gl,
      gl.FRAGMENT_SHADER,
      PRESENTATION_FRAGMENT_SHADER,
      "presentation",
    );
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  try {
    return linkWebGlProgram(gl, vertex, fragment, "presentation");
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
};

/** Owns the optional per-view linear target and its terminal presentation packet. */
export class SurfaceCompositeOwner {
  #bindingRevision = 0;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  readonly #clearIntent: MutableClearFrameIntent = {
    clearColor: [0, 0, 0, 0],
    clearDepth: 1,
    framebuffer: null,
    scissor: null,
    size: { height: 1, width: 1 },
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  readonly #capabilities: LinearCompositeCapabilities;
  readonly #gl: WebGL2RenderingContext;
  #deniedSize = "";
  #sceneColorMaxRoughness = 0;
  readonly #presentationBindings: GpuTextureBinding[] = [{
    sampler: null,
    target: "2d",
    texture: null,
  }];
  readonly #presentationFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #presentationPacket: SurfaceDrawPacket | null = null;
  #program: WebGLProgram | null = null;
  #presentationLocation: WebGLUniformLocation | null = null;
  readonly #presentationValues = new Float32Array(4);
  #resources: CompositeResources | null = null;
  #sceneColorRequired = true;
  #presentationSampler: WebGLSampler | null = null;
  #sceneSampler: WebGLSampler | null = null;
  #sceneColorBinding: GpuTextureBinding = { sampler: null, target: "2d", texture: null };
  #vertexArray: WebGLVertexArrayObject | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    budget: PersistentGpuBudgetOwner,
    capabilities: LinearCompositeCapabilities,
  ) {
    this.#budget = budget;
    this.#capabilities = capabilities;
    this.#gl = gl;
  }

  get bindingRevision(): number {
    return this.#bindingRevision;
  }

  get sceneColorMaxLod(): number {
    if (this.#sceneColorMaxRoughness < 0.1 || this.#resources === null) return 0;
    return transmissionSceneColorMaxLod(this.#resources.width, this.#resources.height);
  }

  get retainedTarget(): boolean {
    return this.#resources !== null;
  }

  resetAdmission(): void {
    this.#deniedSize = "";
  }

  setSceneColorMaxRoughness(maxRoughness: number): void {
    if (this.#sceneColorMaxRoughness === maxRoughness) return;
    const mipmapsWereRequired = this.#sceneColorMaxRoughness >= 0.1;
    const mipmapsRequired = maxRoughness >= 0.1;
    this.#sceneColorMaxRoughness = maxRoughness;
    if (this.#sceneSampler !== null && mipmapsWereRequired !== mipmapsRequired) {
      this.#gl.samplerParameteri(
        this.#sceneSampler,
        this.#gl.TEXTURE_MIN_FILTER,
        mipmapsRequired ? this.#gl.LINEAR_MIPMAP_LINEAR : this.#gl.LINEAR,
      );
    }
  }

  setSceneColorRequired(required: boolean): void {
    this.#sceneColorRequired = required;
  }

  deactivate(): void {
    this.#deleteResources();
    const gl = this.#gl;
    if (this.#program !== null) gl.deleteProgram(this.#program);
    if (this.#presentationSampler !== null) gl.deleteSampler(this.#presentationSampler);
    if (this.#sceneSampler !== null) gl.deleteSampler(this.#sceneSampler);
    if (this.#vertexArray !== null) gl.deleteVertexArray(this.#vertexArray);
    this.#program = null;
    this.#presentationLocation = null;
    this.#presentationPacket = null;
    this.#presentationSampler = null;
    this.#sceneSampler = null;
    this.#sceneColorBinding = { sampler: null, target: "2d", texture: null };
    this.#deniedSize = "";
    this.#vertexArray = null;
  }

  dispose(): void {
    this.deactivate();
  }

  ensure(
    width: number,
    height: number,
    state: WebGlStateOwner,
    requireHdr = false,
    requireFloatBlend = false,
  ): boolean {
    if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
      throw new RangeError("Royal composite target dimensions must be positive safe integers");
    }
    const desiredLevels = this.#sceneColorRequired
      ? transmissionSceneColorMipLevels(width, height, this.#sceneColorMaxRoughness)
      : 0;
    const preferredColorBytesPerPixel = linearCompositeColorBytesPerPixel(
      this.#capabilities,
      requireFloatBlend,
    );
    const retainedFormatIsValid = this.#resources?.colorBytesPerPixel === 4
      ? !requireHdr
      : preferredColorBytesPerPixel === 8;
    if (
      this.#resources?.width === width
      && this.#resources.height === height
      && this.#resources.sceneColorLevels === desiredLevels
      && retainedFormatIsValid
    ) return true;
    const sizeKey = `${width}x${height}:${desiredLevels}:${requireHdr ? 1 : 0}:${requireFloatBlend ? 1 : 0}`;
    if (this.#deniedSize === sizeKey) return false;
    try {
      this.#deleteResources();
      const allocatedPreferred = preferredColorBytesPerPixel === 8
        && this.#allocate(width, height, 8);
      if (!allocatedPreferred && (requireHdr || !this.#allocate(width, height, 4))) {
        this.#deniedSize = sizeKey;
        return false;
      }
      this.#ensurePresentationResources();
    } catch (error) {
      this.#deleteResources();
      throw error;
    } finally {
      state.invalidate();
    }
    this.#deniedSize = "";
    return true;
  }

  framebuffer(): WebGLFramebuffer {
    if (this.#resources === null) throw new Error("Royal composite target is not available");
    return this.#resources.framebuffer;
  }

  sceneColorBinding(): GpuTextureBinding {
    if (this.#resources?.sceneColor === null || this.#resources === null) {
      throw new Error("Royal composite scene-color target is not available");
    }
    return this.#sceneColorBinding;
  }

  clear(color: LinearRgba, state: WebGlStateOwner): void {
    const resources = this.#resources;
    if (resources === null) throw new Error("Royal composite target is not available");
    state.unbindTextureUnit(0);
    const intent = this.#clearIntent;
    intent.clearColor = color;
    intent.framebuffer = resources.framebuffer;
    intent.size.height = resources.height;
    intent.size.width = resources.width;
    intent.viewport.height = resources.height;
    intent.viewport.width = resources.width;
    state.clear(intent);
  }

  snapshot(state: WebGlStateOwner): void {
    const resources = this.#resources;
    if (resources === null || resources.sceneColor === null) {
      throw new Error("Royal composite scene-color target is not available");
    }
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, resources.sceneColor);
    gl.copyTexSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      0,
      0,
      resources.width,
      resources.height,
    );
    if (resources.sceneColorLevels > 1) gl.generateMipmap(gl.TEXTURE_2D);
    state.invalidateTextureUnit(10);
  }

  present(
    framebuffer: WebGLFramebuffer | null,
    viewport: FrameViewport,
    exposure: number,
    toneMapping: "linear-clamp" | "pbr-neutral",
    state: WebGlStateOwner,
  ): void {
    const resources = this.#resources;
    const program = this.#program;
    const vertexArray = this.#vertexArray;
    if (
      resources === null
      || program === null
      || vertexArray === null
      || this.#presentationLocation === null
    ) throw new Error("Royal composite presentation is not available");
    const retainedBinding = this.#presentationBindings[0]!;
    if (
      retainedBinding.sampler !== this.#presentationSampler
      || retainedBinding.texture !== resources.color
    ) {
      this.#presentationBindings[0] = {
        sampler: this.#presentationSampler,
        target: "2d",
        texture: resources.color,
      };
    }
    let packet = this.#presentationPacket;
    if (packet === null) {
      packet = {
        alphaBlend: false,
        colorWrite: true,
        cullBackFaces: false,
        depthTest: false,
        depthWrite: false,
        frontFace: this.#gl.CCW,
        program,
        textureBindings: this.#presentationBindings,
        textureUnits: 1,
        vertexArray,
      };
      this.#presentationPacket = packet;
    }
    this.#presentationFrame.framebuffer = framebuffer;
    this.#presentationFrame.viewport = viewport;
    state.applySurfaceDraw(this.#presentationFrame, packet);
    this.#presentationValues[0] = exposure;
    this.#presentationValues[1] = toneMapping === "pbr-neutral" ? 1 : 0;
    this.#presentationValues[2] = viewport.width / resources.width;
    this.#presentationValues[3] = viewport.height / resources.height;
    this.#gl.uniform4fv(this.#presentationLocation, this.#presentationValues);
    this.#gl.drawArrays(this.#gl.TRIANGLES, 0, 3);
  }

  invalidate(): void {
    this.#resources = null;
    this.#program = null;
    this.#presentationLocation = null;
    this.#presentationPacket = null;
    this.#presentationSampler = null;
    this.#sceneSampler = null;
    this.#sceneColorBinding = { sampler: null, target: "2d", texture: null };
    this.#deniedSize = "";
    this.#vertexArray = null;
    this.#budget.release(this.#claim);
  }

  #allocate(width: number, height: number, colorBytesPerPixel: 4 | 8): boolean {
    const gl = this.#gl;
    const bytes = compositeTargetByteLength(
      width,
      height,
      colorBytesPerPixel,
      {
        sceneColor: this.#sceneColorRequired,
        sceneColorLevels: this.#sceneColorRequired
          ? transmissionSceneColorMipLevels(width, height, this.#sceneColorMaxRoughness)
          : 0,
      },
    );
    if (!this.#budget.tryClaim(this.#claim, bytes)) return false;
    const color = gl.createTexture();
    const sceneColor = this.#sceneColorRequired ? gl.createTexture() : null;
    const depth = gl.createRenderbuffer();
    const framebuffer = gl.createFramebuffer();
    if (
      color === null
      || (this.#sceneColorRequired && sceneColor === null)
      || depth === null
      || framebuffer === null
    ) {
      if (framebuffer !== null) gl.deleteFramebuffer(framebuffer);
      if (depth !== null) gl.deleteRenderbuffer(depth);
      if (sceneColor !== null) gl.deleteTexture(sceneColor);
      if (color !== null) gl.deleteTexture(color);
      this.#budget.release(this.#claim);
      throw new Error("Royal could not allocate composite target resources");
    }
    const internalFormat = colorBytesPerPixel === 8 ? gl.RGBA16F : gl.RGBA8;
    const levels = sceneColor === null
      ? 0
      : transmissionSceneColorMipLevels(width, height, this.#sceneColorMaxRoughness);
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
    if (sceneColor !== null) {
      gl.bindTexture(gl.TEXTURE_2D, sceneColor);
      gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels - 1);
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depth,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(depth);
      gl.deleteTexture(sceneColor);
      gl.deleteTexture(color);
      this.#budget.release(this.#claim);
      return false;
    }
    this.#resources = {
      color,
      colorBytesPerPixel,
      depth,
      framebuffer,
      height,
      sceneColor,
      sceneColorLevels: levels,
      width,
    };
    if (this.#sceneSampler !== null && sceneColor !== null) {
      this.#sceneColorBinding = {
        sampler: this.#sceneSampler,
        target: "2d",
        texture: sceneColor,
      };
    }
    this.#bindingRevision += 1;
    return true;
  }

  #deleteResources(): void {
    const resources = this.#resources;
    if (resources === null) return;
    const gl = this.#gl;
    gl.deleteFramebuffer(resources.framebuffer);
    gl.deleteRenderbuffer(resources.depth);
    if (resources.sceneColor !== null) gl.deleteTexture(resources.sceneColor);
    gl.deleteTexture(resources.color);
    this.#resources = null;
    this.#budget.release(this.#claim);
  }

  #ensurePresentationResources(): void {
    if (this.#program !== null) return;
    const gl = this.#gl;
    const program = createProgram(gl);
    const presentation = gl.getUniformLocation(program, "presentation");
    const sceneColor = gl.getUniformLocation(program, "sceneColor");
    const presentationSampler = gl.createSampler();
    const sceneSampler = gl.createSampler();
    const vertexArray = gl.createVertexArray();
    if (
      presentation === null
      || sceneColor === null
      || presentationSampler === null
      || sceneSampler === null
      || vertexArray === null
    ) {
      gl.deleteProgram(program);
      if (presentationSampler !== null) gl.deleteSampler(presentationSampler);
      if (sceneSampler !== null) gl.deleteSampler(sceneSampler);
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      throw new Error("Royal could not allocate composite presentation resources");
    }
    for (const sampler of [presentationSampler, sceneSampler]) {
      gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.samplerParameteri(presentationSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(
      sceneSampler,
      gl.TEXTURE_MIN_FILTER,
      this.#sceneColorMaxRoughness >= 0.1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
    gl.useProgram(program);
    gl.uniform1i(sceneColor, 0);
    this.#presentationLocation = presentation;
    this.#program = program;
    this.#presentationSampler = presentationSampler;
    this.#sceneSampler = sceneSampler;
    if (this.#resources?.sceneColor !== null && this.#resources !== null) {
      this.#sceneColorBinding = {
        sampler: sceneSampler,
        target: "2d",
        texture: this.#resources.sceneColor,
      };
    }
    this.#vertexArray = vertexArray;
  }
}
