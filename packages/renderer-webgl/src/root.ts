import type {
  BoxGeometry,
  Camera,
  DirectionalLightNode,
  GltfNode,
  Material,
  MeshNode,
  PlaneGeometry,
  RenderNode,
  RenderRoot,
  Rgba,
  StandardMaterial,
  TextNode,
  TextureRef,
  Transform,
  UnlitMaterial,
  Vec3,
} from "@royal/renderer-core";

/** Renderer context options accepted by the WebGL2 backend. */
export interface WebGlRootOptions {
  /** @defaultValue `true` */
  readonly alpha?: boolean;
  /** @defaultValue `true` */
  readonly antialias?: boolean;
  /** @defaultValue `false` */
  readonly preserveDrawingBuffer?: boolean;
}

/** Snapshot of renderer state, intended for tests and host diagnostics. */
export interface WebGlRootSnapshot {
  readonly diagnostics: readonly string[];
  readonly disposed: boolean;
  readonly frame: number;
  readonly latestScene: RenderRoot | undefined;
  readonly options: Required<WebGlRootOptions>;
}

type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

type ProgramKind = "surface" | "wireframe";

type ProgramResource = {
  readonly fragmentShader: WebGLShader;
  readonly program: WebGLProgram;
  readonly vertexShader: WebGLShader;
};

type GeometryResource = {
  readonly arrayBuffer: WebGLBuffer;
  readonly drawCount: number;
  readonly indexBuffer?: WebGLBuffer;
  readonly indexType?: number;
  readonly key: string;
  readonly mode: "lines" | "triangles";
  readonly texCoordBuffer?: WebGLBuffer;
};

type CpuGeometry = {
  readonly indices?: Uint16Array | Uint32Array | Uint8Array;
  readonly key: string;
  readonly mode: "lines" | "triangles";
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array;
};

type TextureResource = {
  readonly key: string;
  readonly texture: WebGLTexture;
  uploaded: boolean;
};

type TextureLoadState = TextureResource & {
  error?: string;
  loading: boolean;
};

type LoadedGltfPrimitive = {
  readonly indices: Uint16Array | Uint32Array | Uint8Array;
  readonly image?: HTMLImageElement | ImageBitmap;
  readonly positions: Float32Array;
  readonly texCoords?: Float32Array;
};

type GltfState = {
  readonly key: string;
  error?: string;
  primitives: readonly LoadedGltfPrimitive[];
  status: "loading" | "ready" | "error";
};

type GltfDocument = {
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly GltfBufferView[];
  readonly buffers?: readonly GltfBuffer[];
  readonly images?: readonly GltfImage[];
  readonly materials?: readonly GltfMaterial[];
  readonly meshes?: readonly GltfMesh[];
  readonly nodes?: readonly GltfSceneNode[];
  readonly scene?: number;
  readonly scenes?: readonly GltfScene[];
  readonly textures?: readonly GltfTexture[];
};

type GltfAccessor = {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
};

type GltfBufferView = {
  readonly buffer?: number;
  readonly byteLength: number;
  readonly byteOffset?: number;
};

type GltfBuffer = {
  readonly uri?: string;
};

type GltfImage = {
  readonly uri?: string;
};

type GltfMaterial = {
  readonly pbrMetallicRoughness?: {
    readonly baseColorTexture?: {
      readonly index?: number;
    };
  };
};

type GltfMesh = {
  readonly primitives?: readonly GltfMeshPrimitive[];
};

type GltfMeshPrimitive = {
  readonly attributes?: {
    readonly POSITION?: number;
    readonly TEXCOORD_0?: number;
  };
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
};

type GltfSceneNode = {
  readonly mesh?: number;
};

type GltfScene = {
  readonly nodes?: readonly number[];
};

type GltfTexture = {
  readonly source?: number;
};

const DEFAULT_COLOR: Rgba = [1, 1, 1, 1];
const DEFAULT_LIGHT_COLOR: Rgba = [1, 1, 1, 1];
const DEFAULT_LIGHT_DIRECTION: Vec3 = [0, -1, 0];
const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const normalizeOptions = (options: WebGlRootOptions = {}): Required<WebGlRootOptions> => ({
  alpha: options.alpha ?? true,
  antialias: options.antialias ?? true,
  preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
});

const identityMat4 = (): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const multiplyMat4 = (left: Mat4, right: Mat4): Mat4 => {
  const out: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ] = [
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[row]! * right[column * 4]!
        + left[4 + row]! * right[column * 4 + 1]!
        + left[8 + row]! * right[column * 4 + 2]!
        + left[12 + row]! * right[column * 4 + 3]!;
    }
  }

  return out;
};

const translationMat4 = ([x, y, z]: Vec3): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

const scaleMat4 = ([x, y, z]: Vec3): Mat4 => [
  x, 0, 0, 0,
  0, y, 0, 0,
  0, 0, z, 0,
  0, 0, 0, 1,
];

const rotationXMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
};

const rotationYMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
};

const rotationZMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
};

const transformMat4 = (transform: Transform | undefined): Mat4 => {
  const actual = transform ?? IDENTITY_TRANSFORM;
  return multiplyMat4(
    translationMat4(actual.position),
    multiplyMat4(
      rotationZMat4(actual.rotation[2]),
      multiplyMat4(
        rotationYMat4(actual.rotation[1]),
        multiplyMat4(rotationXMat4(actual.rotation[0]), scaleMat4(actual.scale)),
      ),
    ),
  );
};

const viewMat4 = (camera: Camera): Mat4 => multiplyMat4(
  multiplyMat4(
    multiplyMat4(
      rotationXMat4(-camera.rotation[0]),
      rotationYMat4(-camera.rotation[1]),
    ),
    rotationZMat4(-camera.rotation[2]),
  ),
  translationMat4([-camera.position[0], -camera.position[1], -camera.position[2]]),
);

const projectionMat4 = (camera: Camera, width: number, height: number): Mat4 => {
  if (camera.kind === "orthographic-camera") {
    const { bottom, far, left, near, right, top } = camera;
    return [
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
    ];
  }

  const aspect = width / Math.max(1, height);
  const f = 1 / Math.tan(camera.fovY / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (camera.far + camera.near) / (camera.near - camera.far), -1,
    0, 0, (2 * camera.far * camera.near) / (camera.near - camera.far), 0,
  ];
};

const textureKey = (texture: TextureRef): string => {
  if (texture.kind === "solid") return `solid:${texture.color.join(",")}:${texture.version ?? ""}`;
  if (texture.kind === "asset") return `asset:${texture.uri}:${texture.version ?? ""}`;

  return `virtual:${texture.manifestUri}:${texture.version ?? ""}`;
};

const materialColor = (material: Material): Rgba => {
  const texture = material.baseColor;
  if (texture.kind === "solid") return texture.color;
  if (texture.kind === "virtual-asset") return texture.fallback?.color ?? texture.preview?.fallback?.color ?? [0.5, 0.5, 0.5, 1];

  return texture.fallback?.color ?? [0.5, 0.5, 0.5, 1];
};

const resolveUrl = (base: string, relative: string): string => {
  if (/^(?:[a-z]+:)?\/\//iu.test(relative) || relative.startsWith("/")) return relative;
  const index = base.lastIndexOf("/");
  return `${index < 0 ? "" : base.slice(0, index + 1)}${relative}`;
};

const samplerConstant = (
  gl: WebGL2RenderingContext,
  value: string | undefined,
  fallback: number,
): number => {
  switch (value) {
    case "clamp-to-edge":
      return gl.CLAMP_TO_EDGE;
    case "linear":
      return gl.LINEAR;
    case "linear-mipmap-linear":
      return gl.LINEAR_MIPMAP_LINEAR;
    case "mirrored-repeat":
      return gl.MIRRORED_REPEAT;
    case "nearest":
      return gl.NEAREST;
    case "repeat":
      return gl.REPEAT;
    default:
      return fallback;
  }
};

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const ImageConstructor = globalThis.Image;
  if (ImageConstructor === undefined) {
    reject(new Error(`Image loading is unavailable for texture ${src}`));
    return;
  }

  const image = new ImageConstructor();
  image.crossOrigin = "anonymous";

  const cleanup = (): void => {
    image.removeEventListener("load", onLoad);
    image.removeEventListener("error", onError);
  };
  const onLoad = (): void => {
    const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
    decoded.then(() => {
      cleanup();
      resolve(image);
    }, (error: unknown) => {
      cleanup();
      reject(error);
    });
  };
  const onError = (event: Event): void => {
    cleanup();
    const message = "message" in event && typeof event.message === "string"
      ? event.message
      : `Image load failed for ${src}`;
    reject(new Error(message));
  };

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  image.src = src;

  if (image.complete) onLoad();
});

const getNodeKind = (node: RenderNode): string =>
  typeof node === "object" && node !== null && "kind" in node && typeof node.kind === "string"
    ? node.kind
    : "unknown";

const componentCount = (type: GltfAccessor["type"]): number => {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
      return 4;
  }
};

/**
 * Minimal Royal WebGL2 renderer root. It implements the descriptor subset used
 * by the contracts while keeping all GPU ownership inside this root.
 */
export class WebGlRoot {
  readonly #canvas: HTMLCanvasElement;
  readonly #gl: WebGL2RenderingContext;
  readonly #options: Required<WebGlRootOptions>;
  readonly #programs = new Map<ProgramKind, ProgramResource>();
  readonly #geometry = new Map<string, GeometryResource>();
  readonly #textures = new Map<string, TextureResource | TextureLoadState>();
  readonly #gltf = new Map<string, GltfState>();
  readonly #ownedBuffers = new Set<WebGLBuffer>();
  readonly #ownedPrograms = new Set<WebGLProgram>();
  readonly #ownedShaders = new Set<WebGLShader>();
  readonly #ownedTextures = new Set<WebGLTexture>();
  #diagnostics: string[] = [];
  #disposed = false;
  #frame = 0;
  #latestScene: RenderRoot | undefined;
  #renderScheduled = false;

  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
    this.#canvas = canvas;
    this.#options = normalizeOptions(options);
    const gl = canvas.getContext("webgl2", this.#options) as WebGL2RenderingContext | null;
    if (gl === null) {
      throw new Error("Royal WebGL renderer requires a WebGL2 context");
    }
    this.#gl = gl;
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get frame(): number {
    return this.#frame;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#latestScene;
  }

  get options(): Required<WebGlRootOptions> {
    return this.#options;
  }

  render(scene: RenderRoot): void {
    if (this.#disposed) {
      throw new Error("Cannot render with a disposed Royal renderer root");
    }

    this.#latestScene = scene;
    const { height, width } = this.#resize();
    const gl = this.#gl;
    gl.viewport(0, 0, width, height);
    gl.clearDepth?.(1);
    gl.enable?.(gl.DEPTH_TEST);
    gl.depthFunc?.(gl.LEQUAL);
    gl.enable?.(gl.BLEND);
    gl.blendFunc?.(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const usedGeometry = new Set<string>();
    for (const renderPass of scene.children) {
      const [r, g, b, a] = renderPass.clearColor;
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const projection = projectionMat4(renderPass.camera, width, height);
      const view = viewMat4(renderPass.camera);
      const lights = renderPass.children.filter((child): child is DirectionalLightNode => child.kind === "directional-light");

      for (const child of renderPass.children) {
        if (child.kind === "directional-light") continue;
        this.#drawNode(child, projection, view, lights[0], usedGeometry);
      }
    }

    this.#releaseUnusedGeometry(usedGeometry);
    this.#frame += 1;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    const gl = this.#gl;
    for (const buffer of Array.from(this.#ownedBuffers)) this.#deleteBuffer(buffer);
    for (const texture of Array.from(this.#ownedTextures)) {
      gl.deleteTexture(texture);
      this.#ownedTextures.delete(texture);
    }
    for (const program of Array.from(this.#ownedPrograms)) {
      gl.deleteProgram(program);
      this.#ownedPrograms.delete(program);
    }
    for (const shader of Array.from(this.#ownedShaders)) {
      gl.deleteShader(shader);
      this.#ownedShaders.delete(shader);
    }

    this.#programs.clear();
    this.#geometry.clear();
    this.#textures.clear();
    this.#gltf.clear();
  }

  snapshot(): WebGlRootSnapshot {
    return {
      diagnostics: [...this.#diagnostics],
      disposed: this.#disposed,
      frame: this.#frame,
      latestScene: this.#latestScene,
      options: { ...this.#options },
    };
  }

  #resize(): { readonly height: number; readonly width: number } {
    const rect = this.#canvas.getBoundingClientRect?.();
    const cssWidth = rect?.width ?? this.#canvas.clientWidth;
    const cssHeight = rect?.height ?? this.#canvas.clientHeight;
    const dpr = globalThis.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.#canvas.width !== width) this.#canvas.width = width;
    if (this.#canvas.height !== height) this.#canvas.height = height;

    return { height, width };
  }

  #drawNode(
    node: RenderNode,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
  ): void {
    switch (node.kind) {
      case "mesh":
        this.#drawMesh(node, projection, view, light, usedGeometry);
        return;
      case "text":
        this.#drawText(node, projection, view, usedGeometry);
        return;
      case "gltf":
        this.#drawGltf(node, projection, view, usedGeometry);
        return;
      default:
        this.#recordDiagnostic(`Unsupported render node kind "${getNodeKind(node)}"`);
    }
  }

  #drawMesh(
    node: MeshNode,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
    usedGeometry: Set<string>,
  ): void {
    const cpu = this.#meshGeometry(node.geometry, node.material);
    const gpu = this.#geometryResource(cpu);
    usedGeometry.add(gpu.key);
    this.#drawGeometry(gpu, node.material, transformMat4(node.transform), projection, view, light);
  }

  #drawText(
    node: TextNode,
    projection: Mat4,
    view: Mat4,
    usedGeometry: Set<string>,
  ): void {
    const bounds = node.layout.bounds;
    if (bounds.xMax <= bounds.xMin || bounds.yMax <= bounds.yMin) return;

    const z = node.layout.lines[0]?.origin[2] ?? 0;
    const positions = new Float32Array([
      bounds.xMin, bounds.yMax, z,
      bounds.xMax, bounds.yMax, z,
      bounds.xMax, bounds.yMin, z,
      bounds.xMin, bounds.yMin, z,
    ]);
    const cpu: CpuGeometry = {
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      key: `text:${node.layout.source}:${node.layout.font.metrics.size}:${bounds.xMin},${bounds.yMin},${bounds.xMax},${bounds.yMax}`,
      mode: "triangles",
      positions,
      texCoords: new Float32Array([
        0, 1,
        1, 1,
        1, 0,
        0, 0,
      ]),
    };
    const gpu = this.#geometryResource(cpu);
    const material: UnlitMaterial = {
      baseColor: { color: node.color, kind: "solid" },
      kind: "unlit",
    };
    usedGeometry.add(gpu.key);
    this.#drawGeometry(gpu, material, identityMat4(), projection, view, undefined);
  }

  #drawGltf(
    node: GltfNode,
    projection: Mat4,
    view: Mat4,
    usedGeometry: Set<string>,
  ): void {
    const state = this.#gltfState(node);
    if (state.status !== "ready") return;

    let index = 0;
    for (const primitive of state.primitives) {
      let material: StandardMaterial = { baseColor: { color: DEFAULT_COLOR, kind: "solid" }, kind: "standard" };
      if (primitive.image !== undefined) {
        const baseColor: Extract<TextureRef, { readonly kind: "asset" }> = {
          colorSpace: "srgb",
          kind: "asset",
          uri: `${state.key}:image:${index}`,
        };
        this.#ensureImmediateTexture(baseColor, primitive.image);
        material = { baseColor, kind: "standard" };
      }
      const cpu: CpuGeometry = {
        indices: primitive.indices,
        key: `${state.key}:primitive:${index}`,
        mode: "triangles",
        positions: primitive.positions,
        ...(primitive.texCoords === undefined ? {} : { texCoords: primitive.texCoords }),
      };
      const gpu = this.#geometryResource(cpu);
      usedGeometry.add(gpu.key);
      this.#drawGeometry(gpu, material, transformMat4(node.transform), projection, view, undefined);
      index += 1;
    }
  }

  #drawGeometry(
    geometry: GeometryResource,
    material: Material,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
    light: DirectionalLightNode | undefined,
  ): void {
    const gl = this.#gl;
    const programResource = this.#program(material.kind === "wireframe" ? "wireframe" : "surface");
    const program = programResource.program;
    gl.useProgram(program);

    this.#uniformMatrix(program, "u_projection", projection);
    this.#uniformMatrix(program, "u_view", view);
    this.#uniformMatrix(program, "u_model", model);
    this.#uniformColor(program, "u_color", materialColor(material));
    if (material.kind === "standard") {
      this.#uniformColor(program, "u_lightColor", light?.color ?? DEFAULT_LIGHT_COLOR);
      this.#uniformVec3(program, "u_lightDirection", light?.direction ?? DEFAULT_LIGHT_DIRECTION);
    } else if (material.kind !== "wireframe") {
      this.#uniformColor(program, "u_lightColor", DEFAULT_LIGHT_COLOR);
    }

    this.#uniform1i(program, "u_useTexture", this.#bindMaterialTexture(program, material) ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.arrayBuffer);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    if (positionLocation >= 0) {
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    }
    if (geometry.texCoordBuffer !== undefined) {
      const uvLocation = gl.getAttribLocation(program, "a_uv");
      if (uvLocation >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.texCoordBuffer);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      }
    }
    if (geometry.indexBuffer !== undefined && geometry.indexType !== undefined) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
    }

    if (material.kind === "wireframe") gl.lineWidth?.(material.width);

    const mode = geometry.mode === "lines" ? gl.LINES : gl.TRIANGLES;
    if (geometry.indexBuffer === undefined || geometry.indexType === undefined) {
      gl.drawArrays(mode, 0, geometry.drawCount);
    } else {
      gl.drawElements(mode, geometry.drawCount, geometry.indexType, 0);
    }
  }

  #bindMaterialTexture(program: WebGLProgram, material: Material): boolean {
    const texture = material.baseColor;
    if (texture.kind === "solid" || texture.kind === "virtual-asset") return false;
    const resource = this.#texture(texture);
    if (!resource.uploaded) return false;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    const location = gl.getUniformLocation(program, "u_texture");
    if (location !== null) gl.uniform1i(location, 0);
    return true;
  }

  #uniformMatrix(program: WebGLProgram, name: string, matrix: Mat4): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
  }

  #uniformColor(program: WebGLProgram, name: string, color: Rgba): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform4fv(location, new Float32Array(color));
  }

  #uniformVec3(program: WebGLProgram, name: string, vector: Vec3): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location === null) return;
    if (typeof this.#gl.uniform3fv === "function") {
      this.#gl.uniform3fv(location, new Float32Array(vector));
    } else {
      this.#gl.uniform3f(location, vector[0], vector[1], vector[2]);
    }
  }

  #uniform1i(program: WebGLProgram, name: string, value: number): void {
    const location = this.#gl.getUniformLocation(program, name);
    if (location !== null) this.#gl.uniform1i(location, value);
  }

  #program(kind: ProgramKind): ProgramResource {
    const cached = this.#programs.get(kind);
    if (cached !== undefined) return cached;

    const program = this.#compileProgram(kind);
    this.#programs.set(kind, program);
    return program;
  }

  #compileProgram(kind: ProgramKind): ProgramResource {
    const gl = this.#gl;
    const program = gl.createProgram();
    if (program === null) throw new Error("WebGL program creation failed");
    this.#ownedPrograms.add(program);

    let vertexShader: WebGLShader | undefined;
    let fragmentShader: WebGLShader | undefined;

    try {
      vertexShader = this.#compileShader(gl.VERTEX_SHADER, this.#vertexShaderSource(kind));
      fragmentShader = this.#compileShader(gl.FRAGMENT_SHADER, this.#fragmentShaderSource(kind));
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.bindAttribLocation?.(program, 0, "a_position");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program) ?? "unknown link error"}`);
      }

      return { fragmentShader, program, vertexShader };
    } catch (error) {
      if (vertexShader !== undefined) this.#deleteShader(vertexShader);
      if (fragmentShader !== undefined) this.#deleteShader(fragmentShader);
      this.#deleteProgram(program);
      throw error;
    }
  }

  #compileShader(type: number, source: string): WebGLShader {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    if (shader === null) throw new Error("WebGL shader creation failed");
    this.#ownedShaders.add(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? "unknown compile error";
      this.#deleteShader(shader);
      throw new Error(`WebGL shader compile failed: ${info}`);
    }

    return shader;
  }

  #vertexShaderSource(_kind: ProgramKind): string {
    return `#version 300 es
in vec3 a_position;
in vec2 a_uv;
uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}`;
  }

  #fragmentShaderSource(kind: ProgramKind): string {
    const lighting = kind === "surface"
      ? "vec4 color = baseColor * u_lightColor;"
      : "vec4 color = baseColor;";
    return `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform bool u_useTexture;
uniform vec4 u_color;
uniform vec4 u_lightColor;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
  vec4 baseColor = u_useTexture ? texture(u_texture, v_uv) : u_color;
  ${lighting}
  outColor = color;
}`;
  }

  #meshGeometry(geometry: MeshNode["geometry"], material: Material): CpuGeometry {
    if (material.kind === "wireframe") return this.#wireGeometry(geometry);

    switch (geometry.kind) {
      case "box":
        return this.#boxGeometry(geometry as BoxGeometry);
      case "plane":
        return this.#planeGeometry(geometry as PlaneGeometry);
      default:
        throw new Error(`Unsupported geometry kind "${geometry.kind}"`);
    }
  }

  #wireGeometry(geometry: MeshNode["geometry"]): CpuGeometry {
    if (geometry.kind === "plane") {
      const plane = geometry as PlaneGeometry;
      const [width, height] = plane.size;
      const x = width / 2;
      const y = height / 2;
      return {
        indices: new Uint16Array([0, 1, 1, 2, 2, 3, 3, 0]),
        key: `wire:plane:${width},${height}`,
        mode: "lines",
        positions: new Float32Array([
          -x, -y, 0,
          x, -y, 0,
          x, y, 0,
          -x, y, 0,
        ]),
        texCoords: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
      };
    }
    if (geometry.kind === "box") {
      const filled = this.#boxGeometry(geometry as BoxGeometry);
      return {
        indices: new Uint16Array([
          0, 1, 1, 2, 2, 3, 3, 0,
          4, 5, 5, 6, 6, 7, 7, 4,
          0, 4, 1, 5, 2, 6, 3, 7,
        ]),
        key: `wire:${filled.key}`,
        mode: "lines",
        positions: filled.positions,
      };
    }

    throw new Error(`Unsupported geometry kind "${geometry.kind}"`);
  }

  #planeGeometry(geometry: PlaneGeometry): CpuGeometry {
    const [width, height] = geometry.size;
    const x = width / 2;
    const y = height / 2;
    return {
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        key: `plane:${width},${height}`,
        mode: "triangles",
        positions: new Float32Array([
        -x, -y, 0,
        x, -y, 0,
          x, y, 0,
          -x, y, 0,
        ]),
        texCoords: new Float32Array([
          0, 0,
          1, 0,
          1, 1,
          0, 1,
        ]),
      };
  }

  #boxGeometry(geometry: BoxGeometry): CpuGeometry {
    const [width, height, depth] = geometry.size;
    const x = width / 2;
    const y = height / 2;
    const z = depth / 2;
    return {
      indices: new Uint16Array([
        0, 1, 2, 0, 2, 3,
        4, 6, 5, 4, 7, 6,
        0, 4, 5, 0, 5, 1,
        3, 2, 6, 3, 6, 7,
        1, 5, 6, 1, 6, 2,
        0, 3, 7, 0, 7, 4,
      ]),
      key: `box:${width},${height},${depth}`,
      mode: "triangles",
      positions: new Float32Array([
        -x, -y, z,
        x, -y, z,
        x, y, z,
        -x, y, z,
        -x, -y, -z,
        x, -y, -z,
        x, y, -z,
        -x, y, -z,
      ]),
      texCoords: new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]),
    };
  }

  #geometryResource(cpu: CpuGeometry): GeometryResource {
    const cached = this.#geometry.get(cpu.key);
    if (cached !== undefined) return cached;

    const gl = this.#gl;
    const arrayBuffer = this.#createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, arrayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cpu.positions, gl.STATIC_DRAW);

    let texCoordBuffer: WebGLBuffer | undefined;
    if (cpu.texCoords !== undefined) {
      texCoordBuffer = this.#createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cpu.texCoords, gl.STATIC_DRAW);
    }

    let indexBuffer: WebGLBuffer | undefined;
    let indexType: number | undefined;
    if (cpu.indices !== undefined) {
      indexBuffer = this.#createBuffer();
      indexType = cpu.indices instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : cpu.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cpu.indices, gl.STATIC_DRAW);
    }

    const resource: GeometryResource = {
      arrayBuffer,
      drawCount: cpu.indices?.length ?? cpu.positions.length / 3,
      ...(indexBuffer === undefined ? {} : { indexBuffer }),
      ...(indexType === undefined ? {} : { indexType }),
      key: cpu.key,
      mode: cpu.mode,
      ...(texCoordBuffer === undefined ? {} : { texCoordBuffer }),
    };
    this.#geometry.set(cpu.key, resource);
    return resource;
  }

  #releaseUnusedGeometry(used: Set<string>): void {
    for (const [key, resource] of this.#geometry) {
      if (used.has(key)) continue;
      this.#deleteBuffer(resource.arrayBuffer);
      if (resource.texCoordBuffer !== undefined) this.#deleteBuffer(resource.texCoordBuffer);
      if (resource.indexBuffer !== undefined) this.#deleteBuffer(resource.indexBuffer);
      this.#geometry.delete(key);
    }
  }

  #texture(texture: Extract<TextureRef, { readonly kind: "asset" }>): TextureResource | TextureLoadState {
    const key = textureKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined) return cached;

    const glTexture = this.#createTexture();
    const state: TextureLoadState = {
      key,
      loading: true,
      texture: glTexture,
      uploaded: false,
    };
    this.#textures.set(key, state);

    loadImage(texture.uri).then((image) => {
      if (this.#disposed) return;
      state.loading = false;
      this.#uploadTexture(state, image, texture);
      this.#scheduleRender();
    }, (error: unknown) => {
      if (this.#disposed) return;
      state.loading = false;
      state.error = `Texture image load failed for ${texture.uri}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    });

    return state;
  }

  #ensureImmediateTexture(texture: Extract<TextureRef, { readonly kind: "asset" }>, image: HTMLImageElement | ImageBitmap): TextureResource {
    const key = textureKey(texture);
    const cached = this.#textures.get(key);
    if (cached !== undefined && cached.uploaded) return cached;

    const resource: TextureResource = cached ?? {
      key,
      texture: this.#createTexture(),
      uploaded: false,
    };
    this.#textures.set(key, resource);
    this.#uploadTexture(resource, image, texture);
    return resource;
  }

  #uploadTexture(
    resource: TextureResource,
    source: HTMLImageElement | ImageBitmap,
    texture: Extract<TextureRef, { readonly kind: "asset" }>,
  ): void {
    if (this.#disposed || !this.#ownedTextures.has(resource.texture)) return;

    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    if (typeof gl.pixelStorei === "function" && gl.UNPACK_FLIP_Y_WEBGL !== undefined) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const sampler = texture.sampler;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, samplerConstant(gl, sampler?.magFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, samplerConstant(gl, sampler?.minFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, samplerConstant(gl, sampler?.wrapS, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, samplerConstant(gl, sampler?.wrapT, gl.CLAMP_TO_EDGE));
    resource.uploaded = true;
  }

  #gltfState(node: GltfNode): GltfState {
    const key = `gltf:${node.asset.uri}:${node.asset.version ?? ""}`;
    const cached = this.#gltf.get(key);
    if (cached !== undefined) return cached;

    const state: GltfState = {
      key,
      primitives: [],
      status: "loading",
    };
    this.#gltf.set(key, state);

    void this.#loadGltf(node.src, state);
    return state;
  }

  async #loadGltf(src: string, state: GltfState): Promise<void> {
    try {
      const response = await fetch(src);
      if (this.#disposed) return;
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const document = await response.json() as GltfDocument;
      if (this.#disposed) return;
      const buffers = await Promise.all((document.buffers ?? []).map(async (buffer) => {
        if (buffer.uri === undefined) return new ArrayBuffer(0);
        const bufferResponse = await fetch(resolveUrl(src, buffer.uri));
        if (!bufferResponse.ok) throw new Error(`${bufferResponse.status} ${bufferResponse.statusText}`);
        return bufferResponse.arrayBuffer();
      }));
      if (this.#disposed) return;
      const images = await Promise.all((document.images ?? []).map((image) =>
        image.uri === undefined ? Promise.resolve(undefined) : loadImage(resolveUrl(src, image.uri))));
      if (this.#disposed) return;

      state.primitives = this.#readGltfPrimitives(document, buffers, images);
      state.status = "ready";
      this.#scheduleRender();
    } catch (error) {
      if (this.#disposed) return;
      state.status = "error";
      state.error = `glTF load failed for ${src}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    }
  }

  #readGltfPrimitives(
    document: GltfDocument,
    buffers: readonly ArrayBuffer[],
    images: readonly (HTMLImageElement | undefined)[],
  ): readonly LoadedGltfPrimitive[] {
    const primitives: LoadedGltfPrimitive[] = [];
    const scene = document.scenes?.[document.scene ?? 0];
    for (const nodeIndex of scene?.nodes ?? []) {
      const sceneNode = document.nodes?.[nodeIndex];
      const mesh = sceneNode?.mesh === undefined ? undefined : document.meshes?.[sceneNode.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        const positionAccessor = primitive.attributes?.POSITION;
        const texCoordAccessor = primitive.attributes?.TEXCOORD_0;
        const indexAccessor = primitive.indices;
        if (positionAccessor === undefined || indexAccessor === undefined) continue;
        const material = primitive.material === undefined ? undefined : document.materials?.[primitive.material];
        const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
        const imageIndex = textureIndex === undefined ? undefined : document.textures?.[textureIndex]?.source;
        primitives.push({
          ...(imageIndex === undefined || images[imageIndex] === undefined ? {} : { image: images[imageIndex] }),
          indices: this.#readGltfIndices(document, buffers, indexAccessor),
          positions: this.#readGltfPositions(document, buffers, positionAccessor),
          ...(texCoordAccessor === undefined ? {} : { texCoords: this.#readGltfTexCoords(document, buffers, texCoordAccessor) }),
        });
      }
    }

    return primitives;
  }

  #readGltfPositions(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    return this.#readGltfFloatAccessor(document, buffers, accessorIndex);
  }

  #readGltfTexCoords(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    return this.#readGltfFloatAccessor(document, buffers, accessorIndex);
  }

  #readGltfFloatAccessor(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Float32Array {
    const accessor = document.accessors?.[accessorIndex];
    if (accessor === undefined || accessor.bufferView === undefined) return new Float32Array();
    const view = document.bufferViews?.[accessor.bufferView];
    if (view === undefined) return new Float32Array();
    const buffer = buffers[view.buffer ?? 0];
    if (buffer === undefined) return new Float32Array();
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const byteLength = accessor.count * componentCount(accessor.type) * Float32Array.BYTES_PER_ELEMENT;
    const bytes = new Uint8Array(buffer, offset, byteLength).slice();

    return new Float32Array(bytes.buffer, 0, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  }

  #readGltfIndices(document: GltfDocument, buffers: readonly ArrayBuffer[], accessorIndex: number): Uint16Array | Uint32Array | Uint8Array {
    const accessor = document.accessors?.[accessorIndex];
    if (accessor === undefined || accessor.bufferView === undefined) return new Uint16Array();
    const view = document.bufferViews?.[accessor.bufferView];
    if (view === undefined) return new Uint16Array();
    const buffer = buffers[view.buffer ?? 0];
    if (buffer === undefined) return new Uint16Array();
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    if (accessor.componentType === 5125) {
      const bytes = new Uint8Array(buffer, offset, accessor.count * Uint32Array.BYTES_PER_ELEMENT).slice();
      return new Uint32Array(bytes.buffer, 0, accessor.count);
    }
    if (accessor.componentType === 5121) return new Uint8Array(buffer, offset, accessor.count).slice();

    const bytes = new Uint8Array(buffer, offset, accessor.count * Uint16Array.BYTES_PER_ELEMENT).slice();
    return new Uint16Array(bytes.buffer, 0, accessor.count);
  }

  #scheduleRender(): void {
    if (this.#disposed || this.#renderScheduled || this.#latestScene === undefined) return;
    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame !== "function") {
      this.render(this.#latestScene);
      return;
    }

    this.#renderScheduled = true;
    requestFrame(() => {
      this.#renderScheduled = false;
      if (!this.#disposed && this.#latestScene !== undefined) this.render(this.#latestScene);
    });
  }

  #createBuffer(): WebGLBuffer {
    const buffer = this.#gl.createBuffer();
    if (buffer === null) throw new Error("WebGL buffer creation failed");
    this.#ownedBuffers.add(buffer);
    return buffer;
  }

  #createTexture(): WebGLTexture {
    const texture = this.#gl.createTexture();
    if (texture === null) throw new Error("WebGL texture creation failed");
    this.#ownedTextures.add(texture);
    return texture;
  }

  #deleteBuffer(buffer: WebGLBuffer): void {
    if (!this.#ownedBuffers.has(buffer)) return;
    this.#gl.deleteBuffer(buffer);
    this.#ownedBuffers.delete(buffer);
  }

  #deleteShader(shader: WebGLShader): void {
    if (!this.#ownedShaders.has(shader)) return;
    this.#gl.deleteShader(shader);
    this.#ownedShaders.delete(shader);
  }

  #deleteProgram(program: WebGLProgram): void {
    if (!this.#ownedPrograms.has(program)) return;
    this.#gl.deleteProgram(program);
    this.#ownedPrograms.delete(program);
  }

  #recordDiagnostic(message: string): void {
    this.#diagnostics = [...this.#diagnostics, message];
    console.warn(message);
  }
}

/** Creates an imperative WebGL2 renderer root. */
export const createWebGlRoot = (
  canvas: HTMLCanvasElement,
  options?: WebGlRootOptions,
): WebGlRoot => new WebGlRoot(canvas, options);
