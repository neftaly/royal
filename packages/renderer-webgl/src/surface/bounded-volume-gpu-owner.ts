import type { SurfaceFrameView } from '../frame/surface-frame';
import { inverseMat4 } from '../math/mat4';
import { PersistentGpuBudgetOwner } from '../resource/persistent-gpu-budget';
import type { GpuTextureBinding } from '../texture/gpu-owner';
import { linkWebGlProgram, compileWebGlShader, requiredWebGlUniform } from '../webgl/program';
import boundedVolumeFragmentShader from '../webgl/shaders/bounded-volume.frag';
import boundedVolumeVertexShader from '../webgl/shaders/bounded-volume.vert';
import { PRESENTATION_GLSL } from '../webgl/shaders/presentation-functions';
import type { MutableSurfaceDrawFrame, SurfaceDrawPacket } from '../webgl/draw-state-transition';
import type { WebGlStateOwner } from '../webgl/state-owner';
import { cameraWorldPositionFromViewInto } from '../math/mat4';
import { frustumPlanesInto, worldBoundsVisible } from './surface-visibility';
import type { CanonicalBoundedVolume } from './bounded-volume-scene';
import { sameCanonicalGeometry } from './canonical-geometry';
import { sortSurfacesBackToFront } from './surface-depth-order';

type VolumeProgram = Readonly<{
  cameraWorldPosition: WebGLUniformLocation;
  color: WebGLUniformLocation;
  densityProfile: WebGLUniformLocation;
  densityProfileCount: WebGLUniformLocation;
  extinctionPerMetre: WebGLUniformLocation;
  heightBounds: WebGLUniformLocation;
  inverseModel: WebGLUniformLocation;
  inverseViewProjection: WebGLUniformLocation;
  model: WebGLUniformLocation;
  noiseScale: WebGLUniformLocation;
  noiseStrength: WebGLUniformLocation;
  perspectiveCamera: WebGLUniformLocation;
  presentation: WebGLUniformLocation;
  planeCount: WebGLUniformLocation;
  planes: WebGLUniformLocation;
  program: WebGLProgram;
  sceneDepth: WebGLUniformLocation;
  viewProjection: WebGLUniformLocation;
  viewport: WebGLUniformLocation;
}>;

type VolumeResource = {
  budgetClaim: object;
  depthOrder: number;
  indexBuffer: WebGLBuffer;
  indexCount: number;
  indexType: number;
  packet: SurfaceDrawPacket;
  surface: CanonicalBoundedVolume;
  vertexBuffer: WebGLBuffer;
};

const createProgram = (gl: WebGL2RenderingContext): VolumeProgram => {
  const vertex = compileWebGlShader(gl, gl.VERTEX_SHADER, boundedVolumeVertexShader, 'bounded volume');
  let fragment: WebGLShader;
  try {
    fragment = compileWebGlShader(
      gl,
      gl.FRAGMENT_SHADER,
      boundedVolumeFragmentShader.replace('__PRESENTATION_FUNCTIONS__', PRESENTATION_GLSL),
      'bounded volume',
    );
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  let program: WebGLProgram;
  try {
    program = linkWebGlProgram(gl, vertex, fragment, 'bounded volume');
  } finally {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
  }
  try {
    const uniform = (name: string): WebGLUniformLocation =>
      requiredWebGlUniform(gl, program, name, 'bounded volume');
    return {
      cameraWorldPosition: uniform('cameraWorldPosition'),
      color: uniform('color'),
      densityProfile: uniform('densityProfile[0]'),
      densityProfileCount: uniform('densityProfileCount'),
      extinctionPerMetre: uniform('extinctionPerMetre'),
      heightBounds: uniform('heightBounds'),
      inverseModel: uniform('inverseModel'),
      inverseViewProjection: uniform('inverseViewProjection'),
      model: uniform('model'),
      noiseScale: uniform('noiseScale'),
      noiseStrength: uniform('noiseStrength'),
      perspectiveCamera: uniform('perspectiveCamera'),
      presentation: uniform('presentation'),
      planeCount: uniform('planeCount'),
      planes: uniform('planes[0]'),
      program,
      sceneDepth: uniform('sceneDepth'),
      viewProjection: uniform('viewProjection'),
      viewport: uniform('viewport'),
    };
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  }
};

const indexType = (gl: WebGL2RenderingContext, indices: Uint8Array | Uint16Array | Uint32Array): number =>
  indices instanceof Uint32Array
    ? gl.UNSIGNED_INT
    : indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;

/** Owns the optional bounded-volume program and exact proxy geometry for one context generation. */
export class BoundedVolumeGpuOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #cameraPosition = new Float32Array(3);
  readonly #drawFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  readonly #drawResources: VolumeResource[] = [];
  readonly #frustumPlanes = new Float32Array(24);
  readonly #gl: WebGL2RenderingContext;
  readonly #presentation = new Float32Array(3);
  readonly #viewport = new Float32Array(4);
  #deniedAvailableBytes: number | null = null;
  #program: VolumeProgram | null = null;
  #resourcesPrepared = false;
  #resources: VolumeResource[] = [];
  #scene: readonly CanonicalBoundedVolume[] = [];

  constructor(gl: WebGL2RenderingContext, budget: PersistentGpuBudgetOwner) {
    this.#budget = budget;
    this.#gl = gl;
  }

  dispose(): void {
    this.#deleteResources();
    if (this.#program !== null) this.#gl.deleteProgram(this.#program.program);
    this.#program = null;
    this.#deniedAvailableBytes = null;
    this.#resourcesPrepared = false;
    this.#scene = [];
  }

  invalidate(): void {
    for (const resource of this.#resources) this.#budget.release(resource.budgetClaim);
    this.#resources = [];
    this.#drawResources.length = 0;
    this.#program = null;
    this.#deniedAvailableBytes = null;
    this.#resourcesPrepared = false;
  }

  setScene(volumes: readonly CanonicalBoundedVolume[]): void {
    if (this.#scene === volumes) return;
    if (
      this.#resourcesPrepared
      && this.#resources.length === volumes.length
      && this.#resources.every((resource, index) =>
        resource.surface.geometry.key === volumes[index]!.geometry.key
        && sameCanonicalGeometry(resource.surface.geometry, volumes[index]!.geometry))
    ) {
      this.#scene = volumes;
      for (let index = 0; index < volumes.length; index += 1) {
        const resource = this.#resources[index]!;
        const volume = volumes[index]!;
        resource.surface = volume;
        const frontFace = volume.modelHandedness < 0 ? this.#gl.CW : this.#gl.CCW;
        if (resource.packet.frontFace !== frontFace) {
          resource.packet = { ...resource.packet, frontFace };
        }
      }
      return;
    }
    this.#deleteResources();
    this.#scene = volumes;
    this.#deniedAvailableBytes = null;
    this.#resourcesPrepared = false;
  }

  plannedRetainedBytes(): number {
    let bytes = 0;
    for (const volume of this.#scene) {
      bytes += volume.geometry.positions.byteLength + volume.geometry.indices.byteLength;
    }
    return bytes;
  }

  hasVisible(views: readonly SurfaceFrameView[]): boolean {
    for (const view of views) {
      frustumPlanesInto(this.#frustumPlanes, view.viewProjection);
      for (const volume of this.#scene) {
        if (worldBoundsVisible(volume.worldBounds, this.#frustumPlanes)) return true;
      }
    }
    return false;
  }

  drawView(
    view: SurfaceFrameView,
    framebuffer: WebGLFramebuffer | null,
    sceneDepth: GpuTextureBinding,
    perspectiveCamera: boolean,
    presentation: Readonly<{
      exposure: number;
      toneMapping: 'linear-clamp' | 'pbr-neutral';
    }> | null,
    state: WebGlStateOwner,
  ): void {
    if (this.#scene.length === 0 || !this.#ensureResources(state)) return;
    const program = this.#program!;
    const inverseViewProjection = inverseMat4(view.viewProjection);
    if (inverseViewProjection === undefined) return;
    frustumPlanesInto(this.#frustumPlanes, view.viewProjection);
    cameraWorldPositionFromViewInto(this.#cameraPosition, view.view);
    this.#drawResources.length = 0;
    for (const resource of this.#resources) {
      if (worldBoundsVisible(resource.surface.worldBounds, this.#frustumPlanes)) {
        this.#drawResources.push(resource);
      }
    }
    sortSurfacesBackToFront(this.#drawResources, view.view);
    this.#drawFrame.framebuffer = framebuffer;
    this.#drawFrame.viewport = view.viewport;
    let globalsInitialized = false;
    for (const resource of this.#drawResources) {
      const volume = resource.surface;
      if (resource.packet.textureBindings[0] !== sceneDepth) {
        resource.packet = { ...resource.packet, textureBindings: [sceneDepth] };
      }
      state.applySurfaceDraw(this.#drawFrame, resource.packet);
      if (!globalsInitialized) {
        this.#gl.uniform1i(program.sceneDepth, 0);
        this.#gl.uniform1i(program.perspectiveCamera, perspectiveCamera ? 1 : 0);
        this.#presentation[0] = presentation?.exposure ?? 1;
        this.#presentation[1] = presentation?.toneMapping === 'pbr-neutral' ? 1 : 0;
        this.#presentation[2] = presentation === null ? 0 : 1;
        this.#gl.uniform3fv(program.presentation, this.#presentation);
        this.#viewport[0] = view.viewport.x;
        this.#viewport[1] = view.viewport.y;
        this.#viewport[2] = view.viewport.width;
        this.#viewport[3] = view.viewport.height;
        this.#gl.uniform4fv(program.viewport, this.#viewport);
        this.#gl.uniform3fv(program.cameraWorldPosition, this.#cameraPosition);
        this.#gl.uniformMatrix4fv(program.inverseViewProjection, false, inverseViewProjection);
        this.#gl.uniformMatrix4fv(program.viewProjection, false, view.viewProjection);
        globalsInitialized = true;
      }
      this.#gl.uniform4fv(program.color, volume.color);
      this.#gl.uniform2fv(program.densityProfile, volume.densityProfile);
      this.#gl.uniform1i(program.densityProfileCount, volume.densityProfileCount);
      this.#gl.uniform1f(program.extinctionPerMetre, volume.extinctionPerMetre);
      this.#gl.uniform2f(
        program.heightBounds,
        volume.geometry.bounds.min[1],
        volume.geometry.bounds.max[1],
      );
      this.#gl.uniformMatrix4fv(program.inverseModel, false, volume.inverseModel);
      this.#gl.uniformMatrix4fv(program.model, false, volume.model);
      this.#gl.uniform3fv(program.noiseScale, volume.noiseScale);
      this.#gl.uniform1f(program.noiseStrength, volume.noiseStrength);
      this.#gl.uniform1i(program.planeCount, volume.planeCount);
      this.#gl.uniform4fv(program.planes, volume.planes);
      this.#gl.drawElements(
        this.#gl.TRIANGLES,
        resource.indexCount,
        resource.indexType,
        0,
      );
    }
  }

  #ensureResources(state: WebGlStateOwner): boolean {
    if (this.#resourcesPrepared) {
      if (
        this.#resources.length === this.#scene.length
        || this.#deniedAvailableBytes === null
        || this.#budget.availableBytes <= this.#deniedAvailableBytes
      ) return this.#resources.length > 0;
    }
    this.#deleteResources();
    this.#program ??= createProgram(this.#gl);
    const resources: VolumeResource[] = [];
    for (const volume of this.#scene) {
      const bytes = volume.geometry.positions.byteLength + volume.geometry.indices.byteLength;
      const budgetClaim = {};
      if (!this.#budget.tryClaim(budgetClaim, bytes)) continue;
      const vertexBuffer = this.#gl.createBuffer();
      const indexBuffer = this.#gl.createBuffer();
      const vertexArray = this.#gl.createVertexArray();
      if (vertexBuffer === null || indexBuffer === null || vertexArray === null) {
        if (vertexArray !== null) this.#gl.deleteVertexArray(vertexArray);
        if (indexBuffer !== null) this.#gl.deleteBuffer(indexBuffer);
        if (vertexBuffer !== null) this.#gl.deleteBuffer(vertexBuffer);
        this.#budget.release(budgetClaim);
        this.#deleteResources(resources);
        throw new Error('Royal could not allocate bounded volume geometry');
      }
      this.#gl.bindVertexArray(vertexArray);
      this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, vertexBuffer);
      this.#gl.bufferData(this.#gl.ARRAY_BUFFER, volume.geometry.positions, this.#gl.STATIC_DRAW);
      this.#gl.enableVertexAttribArray(0);
      this.#gl.vertexAttribPointer(0, 3, this.#gl.FLOAT, false, 12, 0);
      this.#gl.bindBuffer(this.#gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      this.#gl.bufferData(this.#gl.ELEMENT_ARRAY_BUFFER, volume.geometry.indices, this.#gl.STATIC_DRAW);
      const packet: SurfaceDrawPacket = {
        alphaBlend: true,
        colorWrite: true,
        cullBackFaces: false,
        depthTest: false,
        depthWrite: false,
        frontFace: volume.modelHandedness < 0 ? this.#gl.CW : this.#gl.CCW,
        program: this.#program.program,
        textureBindings: [{ sampler: null, target: '2d', texture: null }],
        textureUnits: 1,
        vertexArray,
      };
      resources.push({
        budgetClaim,
        depthOrder: 0,
        indexBuffer,
        indexCount: volume.geometry.indices.length,
        indexType: indexType(this.#gl, volume.geometry.indices),
        packet,
        surface: volume,
        vertexBuffer,
      });
    }
    this.#resources = resources;
    this.#resourcesPrepared = true;
    this.#deniedAvailableBytes = resources.length === this.#scene.length
      ? null
      : this.#budget.availableBytes;
    state.invalidateVertexArray();
    return resources.length > 0;
  }

  #deleteResources(resources: readonly VolumeResource[] = this.#resources): void {
    for (const resource of resources) {
      this.#gl.deleteVertexArray(resource.packet.vertexArray);
      this.#gl.deleteBuffer(resource.indexBuffer);
      this.#gl.deleteBuffer(resource.vertexBuffer);
      this.#budget.release(resource.budgetClaim);
    }
    if (resources === this.#resources) {
      this.#resources = [];
      this.#drawResources.length = 0;
    }
  }
}
