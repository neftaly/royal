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
import { textMesh } from "@royal/renderer-core/text";

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
  readonly baseColorImageUri?: string;
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

type MinimalVirtualTextureManifest = {
  readonly pages?: unknown;
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
  if (texture.kind === "solid") {
    return `solid:${texture.color.join(",")}:${texture.colorSpace ?? ""}:${texture.version ?? ""}`;
  }
  if (texture.kind === "asset") {
    const sampler = texture.sampler;
    return [
      "asset",
      texture.uri,
      texture.version ?? "",
      texture.colorSpace ?? "",
      sampler?.magFilter ?? "",
      sampler?.minFilter ?? "",
      sampler?.wrapS ?? "",
      sampler?.wrapT ?? "",
    ].join(":");
  }

  const sampler = texture.sampler;
  return [
    "virtual",
    texture.manifestUri,
    texture.version ?? "",
    texture.colorSpace ?? "",
    sampler?.magFilter ?? "",
    sampler?.minFilter ?? "",
    sampler?.wrapS ?? "",
    sampler?.wrapT ?? "",
    texture.preview === undefined ? "" : textureKey(texture.preview),
  ].join(":");
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
    case "linear-mipmap-nearest":
      return gl.LINEAR_MIPMAP_NEAREST;
    case "mirrored-repeat":
      return gl.MIRRORED_REPEAT;
    case "nearest":
      return gl.NEAREST;
    case "nearest-mipmap-linear":
      return gl.NEAREST_MIPMAP_LINEAR;
    case "nearest-mipmap-nearest":
      return gl.NEAREST_MIPMAP_NEAREST;
    case "repeat":
      return gl.REPEAT;
    default:
      return fallback;
  }
};

const usesMipmaps = (value: string | undefined): boolean =>
  value === "linear-mipmap-linear"
  || value === "linear-mipmap-nearest"
  || value === "nearest-mipmap-linear"
  || value === "nearest-mipmap-nearest";

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

const loadFetchedImage = async (src: string): Promise<HTMLImageElement | ImageBitmap> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  if (typeof globalThis.createImageBitmap === "function" && typeof response.blob === "function") {
    return await globalThis.createImageBitmap(await response.blob());
  }

  return await loadImage(src);
};

const getNodeKind = (node: RenderNode): string =>
  typeof node === "object" && node !== null && "kind" in node && typeof node.kind === "string"
    ? node.kind
    : "unknown";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const firstManifestEntryUri = (entries: unknown): string | undefined => {
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (typeof entry.uri === "string" && entry.uri.length > 0) return entry.uri;
    }
    return undefined;
  }

  if (!isRecord(entries)) return undefined;
  for (const uri of Object.values(entries)) {
    if (typeof uri === "string" && uri.length > 0) return uri;
  }
  return undefined;
};

const templateManifestPageUri = (template: string): string =>
  template
    .replaceAll("{page}", "m0/0/0")
    .replaceAll("{mip}", "0")
    .replaceAll("{x}", "0")
    .replaceAll("{y}", "0");

const firstVirtualTexturePageUri = (manifest: MinimalVirtualTextureManifest): string | undefined => {
  if (Array.isArray(manifest.pages)) return firstManifestEntryUri(manifest.pages);
  if (!isRecord(manifest.pages)) return undefined;

  const explicit = firstManifestEntryUri(manifest.pages.entries);
  if (explicit !== undefined) return explicit;
  return typeof manifest.pages.uriTemplate === "string" && manifest.pages.uriTemplate.length > 0
    ? templateManifestPageUri(manifest.pages.uriTemplate)
    : undefined;
};

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
  #dprMediaQuery: MediaQueryList | undefined;
  #diagnostics: string[] = [];
  #disposed = false;
  #frame = 0;
  #latestScene: RenderRoot | undefined;
  #renderScheduled = false;
  #resizeObserver: ResizeObserver | undefined;
  readonly #viewportInvalidationListener = (): void => {
    this.#scheduleRender();
  };

  constructor(canvas: HTMLCanvasElement, options?: WebGlRootOptions) {
    this.#canvas = canvas;
    this.#options = normalizeOptions(options);
    const gl = canvas.getContext("webgl2", this.#options) as WebGL2RenderingContext | null;
    if (gl === null) {
      throw new Error("Royal WebGL renderer requires a WebGL2 context");
    }
    this.#gl = gl;
    this.#watchViewport();
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
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#dprMediaQuery?.removeEventListener?.("change", this.#viewportInvalidationListener);
    this.#dprMediaQuery?.removeListener?.(this.#viewportInvalidationListener);
    this.#dprMediaQuery = undefined;
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

  #watchViewport(): void {
    const ResizeObserverConstructor = globalThis.ResizeObserver;
    if (typeof ResizeObserverConstructor === "function") {
      this.#resizeObserver = new ResizeObserverConstructor(this.#viewportInvalidationListener);
      this.#resizeObserver.observe(this.#canvas);
    }

    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia === "function") {
      this.#dprMediaQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
      this.#dprMediaQuery.addEventListener?.("change", this.#viewportInvalidationListener);
      this.#dprMediaQuery.addListener?.(this.#viewportInvalidationListener);
    }
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
    const model = transformMat4(node.transform);
    if (!this.#isVisible(cpu.positions, model, projection, view)) return;
    if (node.material.kind === "standard" && light === undefined) {
      throw new Error("standardMaterial meshes require a directionalLight in the render pass");
    }
    const gpu = this.#geometryResource(cpu);
    usedGeometry.add(gpu.key);
    this.#drawGeometry(gpu, node.material, model, projection, view, light);
  }

  #drawText(
    node: TextNode,
    projection: Mat4,
    view: Mat4,
    usedGeometry: Set<string>,
  ): void {
    const mesh = textMesh(node);
    if (mesh.vertices.length === 0 || mesh.indices.length === 0) return;

    const positions = new Float32Array(mesh.vertices.length * 3);
    const texCoords = new Float32Array(mesh.vertices.length * 2);
    for (const [index, vertex] of mesh.vertices.entries()) {
      positions[index * 3] = vertex.position[0];
      positions[index * 3 + 1] = vertex.position[1];
      positions[index * 3 + 2] = vertex.position[2];
      texCoords[index * 2] = vertex.glyphCoord[0];
      texCoords[index * 2 + 1] = vertex.glyphCoord[1];
    }
    const indices = mesh.vertices.length > 65535
      ? new Uint32Array(mesh.indices)
      : new Uint16Array(mesh.indices);
    const cpu: CpuGeometry = {
      indices,
      key: `text:${node.layout.source}:${node.layout.font.metrics.size}:${mesh.vertices.length}:${mesh.indices.length}`,
      mode: "triangles",
      positions,
      texCoords,
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
      const model = transformMat4(node.transform);
      if (!this.#isVisible(cpu.positions, model, projection, view)) {
        index += 1;
        continue;
      }
      const gpu = this.#geometryResource(cpu);
      usedGeometry.add(gpu.key);
      this.#drawGeometry(gpu, material, model, projection, view, undefined);
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
    const uvLocation = gl.getAttribLocation(program, "a_uv");
    if (uvLocation >= 0) {
      if (geometry.texCoordBuffer !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.texCoordBuffer);
        gl.enableVertexAttribArray(uvLocation);
        gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray?.(uvLocation);
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
    if (material.baseColor.kind === "solid") return false;
    let resource: TextureResource | TextureLoadState;
    if (material.baseColor.kind === "virtual-asset") {
      if (material.baseColor.preview === undefined) {
        resource = this.#virtualTexture(material.baseColor);
      } else {
        const preview = this.#texture(material.baseColor.preview);
        const previewError = "error" in preview && preview.error !== undefined;
        resource = preview.uploaded || !previewError
          ? preview
          : this.#virtualTexture(material.baseColor);
      }
    } else {
      resource = this.#texture(material.baseColor);
    }
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
      const box = geometry as BoxGeometry;
      const [width, height, depth] = box.size;
      const x = width / 2;
      const y = height / 2;
      const z = depth / 2;
      return {
        indices: new Uint16Array([
          0, 1, 1, 2, 2, 3, 3, 0,
          4, 5, 5, 6, 6, 7, 7, 4,
          0, 4, 1, 5, 2, 6, 3, 7,
        ]),
        key: `wire:box:${width},${height},${depth}`,
        mode: "lines",
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
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
        12, 13, 14, 12, 14, 15,
        16, 17, 18, 16, 18, 19,
        20, 21, 22, 20, 22, 23,
      ]),
      key: `box:${width},${height},${depth}`,
      mode: "triangles",
      positions: new Float32Array([
        -x, -y, z,
        x, -y, z,
        x, y, z,
        -x, y, z,
        x, -y, -z,
        -x, -y, -z,
        -x, y, -z,
        x, y, -z,
        -x, -y, -z,
        -x, -y, z,
        -x, y, z,
        -x, y, -z,
        x, -y, z,
        x, -y, -z,
        x, y, -z,
        x, y, z,
        -x, y, z,
        x, y, z,
        x, y, -z,
        -x, y, -z,
        -x, -y, -z,
        x, -y, -z,
        x, -y, z,
        -x, -y, z,
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
        0, 0,
        1, 0,
        1, 1,
        0, 1,
        0, 0,
        1, 0,
        1, 1,
        0, 1,
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

  #isVisible(
    positions: Float32Array,
    model: Mat4,
    projection: Mat4,
    view: Mat4,
  ): boolean {
    if (positions.length === 0) return false;

    const mvp = multiplyMat4(projection, multiplyMat4(view, model));
    const outside = [true, true, true, true, true, true];
    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index]!;
      const y = positions[index + 1]!;
      const z = positions[index + 2]!;
      const clipX = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const clipY = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      const clipZ = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14];
      const clipW = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      outside[0] &&= clipX < -clipW;
      outside[1] &&= clipX > clipW;
      outside[2] &&= clipY < -clipW;
      outside[3] &&= clipY > clipW;
      outside[4] &&= clipZ < -clipW;
      outside[5] &&= clipZ > clipW;
    }

    return !outside.some(Boolean);
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

  #virtualTexture(texture: Extract<TextureRef, { readonly kind: "virtual-asset" }>): TextureResource | TextureLoadState {
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

    this.#loadVirtualTexturePage(texture).then((image) => {
      if (this.#disposed) return;
      state.loading = false;
      const uploadTexture: Extract<TextureRef, { readonly kind: "asset" }> = {
        kind: "asset",
        uri: texture.manifestUri,
        ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
        ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
        ...(texture.version === undefined ? {} : { version: texture.version }),
      };
      this.#uploadTexture(state, image, uploadTexture);
      this.#scheduleRender();
    }, (error: unknown) => {
      if (this.#disposed) return;
      state.loading = false;
      state.error = `Virtual texture load failed for ${texture.manifestUri}: ${error instanceof Error ? error.message : String(error)}`;
      this.#recordDiagnostic(state.error);
    });

    return state;
  }

  async #loadVirtualTexturePage(
    texture: Extract<TextureRef, { readonly kind: "virtual-asset" }>,
  ): Promise<HTMLImageElement | ImageBitmap> {
    const response = await fetch(texture.manifestUri);
    if (!response.ok) throw new Error(`manifest ${response.status} ${response.statusText}`);
    const manifest = await response.json() as MinimalVirtualTextureManifest;
    const pageUri = firstVirtualTexturePageUri(manifest);
    if (pageUri === undefined) {
      throw new Error("manifest does not reference any page image");
    }

    return await loadFetchedImage(resolveUrl(texture.manifestUri, pageUri));
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
    if (usesMipmaps(sampler?.minFilter)) gl.generateMipmap(gl.TEXTURE_2D);
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
      state.primitives = this.#readGltfPrimitives(document, buffers, src);
      state.status = "ready";
      this.#scheduleRender();
      this.#loadGltfImages(src, document, state);
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
    src: string,
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
        const imageUri = imageIndex === undefined ? undefined : document.images?.[imageIndex]?.uri;
        primitives.push({
          ...(imageUri === undefined ? {} : { baseColorImageUri: resolveUrl(src, imageUri) }),
          indices: this.#readGltfIndices(document, buffers, indexAccessor),
          positions: this.#readGltfPositions(document, buffers, positionAccessor),
          ...(texCoordAccessor === undefined ? {} : { texCoords: this.#readGltfTexCoords(document, buffers, texCoordAccessor) }),
        });
      }
    }

    return primitives;
  }

  #loadGltfImages(src: string, document: GltfDocument, state: GltfState): void {
    for (const image of document.images ?? []) {
      if (image.uri === undefined) continue;
      const uri = resolveUrl(src, image.uri);
      loadImage(uri).then((loadedImage) => {
        if (this.#disposed || state.status !== "ready") return;
        state.primitives = state.primitives.map((primitive) =>
          primitive.baseColorImageUri === uri
            ? { ...primitive, image: loadedImage }
            : primitive);
        this.#scheduleRender();
      }, (error: unknown) => {
        if (this.#disposed) return;
        this.#recordDiagnostic(`glTF base-color image load failed for ${uri}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
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
