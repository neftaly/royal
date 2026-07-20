import type { LinearRgba } from "@royal/renderer-core";
import type { FrameViewport, MutableClearFrameIntent } from "../frame/clear-frame";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type { GpuTextureBinding } from "../texture/gpu-owner";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type { MutableSurfaceDrawStateIntent } from "../webgl/draw-state-transition";
import presentationFragmentShader from "../webgl/shaders/presentation.frag";
import presentationVertexShader from "../webgl/shaders/presentation.vert";
import { PRESENTATION_GLSL } from "../webgl/shaders/presentation-functions";
import type { SurfaceTransmissionShaderSource } from "./surface-program-owner";
import {
  linearCompositeColorBytesPerPixel,
  type LinearCompositeCapabilities,
} from "./terminal-presentation-plan";

export const transmissionShaderSource: SurfaceTransmissionShaderSource = {
  fragmentDeclarations: `
#ifdef TRANSMISSION_MATERIAL
uniform sampler2D sceneColor;
uniform vec4 attenuationColor;
uniform vec4 transmissionFactors;
uniform mat4 viewProjection;
#endif
#ifdef TRANSMISSION_TEXTURED
in vec2 surfaceTransmissionTextureCoordinate;
uniform sampler2D transmissionTexture;
#endif
#ifdef THICKNESS_TEXTURED
in vec2 surfaceThicknessTextureCoordinate;
uniform sampler2D thicknessTexture;
#endif
`,
  fragmentBody: `
#ifdef TRANSMISSION_MATERIAL
  float transmission = transmissionFactors.x;
#ifdef TRANSMISSION_TEXTURED
  transmission *= texture(transmissionTexture, surfaceTransmissionTextureCoordinate).r;
#endif
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
  vec2 sourceCoordinate = gl_FragCoord.xy / vec2(textureSize(sceneColor, 0));
  vec2 refractedCoordinate = exitClip.xy / max(abs(exitClip.w), 0.000001) * 0.5 + 0.5;
  vec2 sampleCoordinate = thickness > 0.0 ? refractedCoordinate : sourceCoordinate;
  bool sourceAvailable = exitClip.w > 0.0
    && all(greaterThanEqual(sampleCoordinate, vec2(0.0)))
    && all(lessThanEqual(sampleCoordinate, vec2(1.0)));
  float sourceLod = roughness * transmissionFactors.w;
  vec3 transmitted = sourceAvailable
    ? textureLod(sceneColor, sampleCoordinate, sourceLod).rgb
    : linear;
  if (attenuationColor.a > 0.0 && thickness > 0.0) {
    transmitted *= pow(
      max(attenuationColor.rgb, vec3(0.000001)),
      vec3(transmissionDistance * attenuationColor.a)
    );
  }
  vec3 viewFresnel = mix(f0, f90, fresnelPower(normalView));
  float transmissionWeight = transmission
    * (1.0 - metallic)
    * (1.0 - max(viewFresnel.r, max(viewFresnel.g, viewFresnel.b)));
  linear = mix(linear, transmitted, clamp(transmissionWeight, 0.0, 1.0));
#endif
`,
  vertexDeclarations: `
#ifdef TRANSMISSION_TEXTURED
uniform vec4 transmissionTextureCoordinates0;
uniform vec4 transmissionTextureCoordinates1;
out vec2 surfaceTransmissionTextureCoordinate;
#endif
#ifdef THICKNESS_TEXTURED
uniform vec4 thicknessTextureCoordinates0;
uniform vec4 thicknessTextureCoordinates1;
out vec2 surfaceThicknessTextureCoordinate;
#endif
`,
  vertexBody: `
#ifdef TRANSMISSION_TEXTURED
  surfaceTransmissionTextureCoordinate = transformedTextureCoordinate(
    transmissionTextureCoordinates0,
    transmissionTextureCoordinates1
  );
#endif
#ifdef THICKNESS_TEXTURED
  surfaceThicknessTextureCoordinate = transformedTextureCoordinate(
    thicknessTextureCoordinates0,
    thicknessTextureCoordinates1
  );
#endif
`,
};

type CompositeResources = Readonly<{
  color: WebGLTexture;
  colorBytesPerPixel: 4 | 8;
  depthStencil: WebGLRenderbuffer;
  framebuffer: WebGLFramebuffer;
  height: number;
  sceneColor: WebGLTexture | null;
  sceneColorLevels: number;
  width: number;
}>;

const mipLevels = (width: number, height: number): number =>
  Math.floor(Math.log2(Math.max(width, height))) + 1;

const mipPixelCount = (width: number, height: number): number => {
  let pixels = 0;
  while (true) {
    pixels += width * height;
    if (width === 1 && height === 1) return pixels;
    width = Math.max(1, width >>> 1);
    height = Math.max(1, height >>> 1);
  }
};

export const compositeTargetByteLength = (
  width: number,
  height: number,
  colorBytesPerPixel: 4 | 8,
  options: Readonly<{
    mipmappedSceneColor?: boolean;
    sceneColor?: boolean;
  }> = {},
): number => width * height * (colorBytesPerPixel + 4)
  + (options.sceneColor === false
    ? 0
    : (options.mipmappedSceneColor === false ? width * height : mipPixelCount(width, height))
      * colorBytesPerPixel);

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Royal could not allocate a presentation shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const detail = gl.getShaderInfoLog(shader) ?? "unknown compiler failure";
    gl.deleteShader(shader);
    throw new Error(`Royal presentation shader compilation failed: ${detail}`);
  }
  return shader;
};

const PRESENTATION_FRAGMENT_SHADER = presentationFragmentShader.replace(
  "__PRESENTATION_FUNCTIONS__",
  PRESENTATION_GLSL,
);

const createProgram = (gl: WebGL2RenderingContext): WebGLProgram => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, presentationVertexShader);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, PRESENTATION_FRAGMENT_SHADER);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    throw new Error("Royal could not allocate a presentation program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const detail = gl.getProgramInfoLog(program) ?? "unknown linker failure";
    gl.deleteProgram(program);
    throw new Error(`Royal presentation program link failed: ${detail}`);
  }
  return program;
};

/** Owns the optional per-view linear target and its terminal presentation packet. */
export class SurfaceCompositeOwner {
  #bindingRevision = 0;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #claim = {};
  readonly #clearIntent: MutableClearFrameIntent = {
    clearColor: [0, 0, 0, 0],
    clearDepth: 1,
    clearStencil: 0,
    framebuffer: null,
    scissor: null,
    size: { height: 1, width: 1 },
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  readonly #capabilities: LinearCompositeCapabilities;
  readonly #gl: WebGL2RenderingContext;
  #deniedSize = "";
  #mipmapsRequired = false;
  readonly #presentationBindings: GpuTextureBinding[] = [{
    sampler: null,
    target: "2d",
    texture: null,
  }];
  #presentationIntent: MutableSurfaceDrawStateIntent | null = null;
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
    return this.#mipmapsRequired ? (this.#resources?.sceneColorLevels ?? 1) - 1 : 0;
  }

  get retainedTarget(): boolean {
    return this.#resources !== null;
  }

  resetAdmission(): void {
    this.#deniedSize = "";
  }

  setMipmapsRequired(required: boolean): void {
    if (this.#mipmapsRequired === required) return;
    this.#mipmapsRequired = required;
    if (this.#sceneSampler !== null) {
      this.#gl.samplerParameteri(
        this.#sceneSampler,
        this.#gl.TEXTURE_MIN_FILTER,
        required ? this.#gl.LINEAR_MIPMAP_LINEAR : this.#gl.LINEAR,
      );
    }
    this.#bindingRevision += 1;
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
    this.#presentationIntent = null;
    this.#presentationBindings[0] = { sampler: null, target: "2d", texture: null };
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
      ? this.#mipmapsRequired ? mipLevels(width, height) : 1
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
    if (this.#mipmapsRequired) gl.generateMipmap(gl.TEXTURE_2D);
    state.invalidateTextureBindings();
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
    let intent = this.#presentationIntent;
    if (intent === null) {
      intent = {
        alphaBlend: false,
        cullBackFaces: false,
        depthTest: false,
        depthWrite: false,
        framebuffer,
        frontFace: this.#gl.CCW,
        program,
        textureBindings: this.#presentationBindings,
        textureUnits: 1,
        vertexArray,
        viewport: { height: viewport.height, width: viewport.width, x: viewport.x, y: viewport.y },
      };
      this.#presentationIntent = intent;
    } else {
      intent.framebuffer = framebuffer;
      intent.viewport.height = viewport.height;
      intent.viewport.width = viewport.width;
      intent.viewport.x = viewport.x;
      intent.viewport.y = viewport.y;
    }
    state.applySurfaceDraw(intent);
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
    this.#presentationIntent = null;
    this.#presentationBindings[0] = { sampler: null, target: "2d", texture: null };
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
        mipmappedSceneColor: this.#mipmapsRequired,
        sceneColor: this.#sceneColorRequired,
      },
    );
    if (!this.#budget.tryClaim(this.#claim, bytes)) return false;
    const color = gl.createTexture();
    const sceneColor = this.#sceneColorRequired ? gl.createTexture() : null;
    const depthStencil = gl.createRenderbuffer();
    const framebuffer = gl.createFramebuffer();
    if (
      color === null
      || (this.#sceneColorRequired && sceneColor === null)
      || depthStencil === null
      || framebuffer === null
    ) {
      if (framebuffer !== null) gl.deleteFramebuffer(framebuffer);
      if (depthStencil !== null) gl.deleteRenderbuffer(depthStencil);
      if (sceneColor !== null) gl.deleteTexture(sceneColor);
      if (color !== null) gl.deleteTexture(color);
      this.#budget.release(this.#claim);
      throw new Error("Royal could not allocate composite target resources");
    }
    const internalFormat = colorBytesPerPixel === 8 ? gl.RGBA16F : gl.RGBA8;
    const levels = sceneColor === null ? 0 : this.#mipmapsRequired ? mipLevels(width, height) : 1;
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
    if (sceneColor !== null) {
      gl.bindTexture(gl.TEXTURE_2D, sceneColor);
      gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, width, height);
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      depthStencil,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(depthStencil);
      gl.deleteTexture(sceneColor);
      gl.deleteTexture(color);
      this.#budget.release(this.#claim);
      return false;
    }
    this.#resources = {
      color,
      colorBytesPerPixel,
      depthStencil,
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
    gl.deleteRenderbuffer(resources.depthStencil);
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
      this.#mipmapsRequired ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
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
