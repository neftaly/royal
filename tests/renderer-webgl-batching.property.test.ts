import { afterEach, describe, expect, it, vi } from "vitest";
import {
  directionalLight,
  gltf,
  orthographicCamera,
  scene,
  type RenderNode,
  type RenderRoot,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import { forEachFuzzCaseAsync, type SeededRandom } from "./fuzz";

type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly args: readonly unknown[];
  readonly name: string;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type GltfMaterial = Record<string, unknown>;

type BatchDimension = {
  readonly extensionsUsed?: readonly string[];
  readonly name: string;
  readonly pair: (random: SeededRandom) => readonly [GltfMaterial, GltfMaterial];
};

const defaultCanvasSize: CanvasSize = { height: 180, width: 320 };
const batchingGltfSrc = "https://example.test/fixtures/batching-triangle.gltf";
const triangleBinUri = "batching-triangle.bin";
const triangleBinByteLength = 104;

const round = (value: number): number => Number(value.toFixed(3));
const unit = (random: SeededRandom): number => round(random.number(0.12, 0.82));
const shiftedUnit = (value: number): number => round(value < 0.5 ? value + 0.37 : value - 0.37);
const rgba = (random: SeededRandom): readonly [number, number, number, number] => [
  unit(random),
  unit(random),
  unit(random),
  1,
];
const shiftedRgba = (value: readonly [number, number, number, number]): readonly [number, number, number, number] => [
  shiftedUnit(value[0]),
  shiftedUnit(value[1]),
  shiftedUnit(value[2]),
  value[3],
];
const vec3 = (random: SeededRandom): readonly [number, number, number] => [
  unit(random),
  unit(random),
  unit(random),
];
const shiftedVec3 = (value: readonly [number, number, number]): readonly [number, number, number] => [
  shiftedUnit(value[0]),
  shiftedUnit(value[1]),
  shiftedUnit(value[2]),
];

const pbrMaterial = (
  random: SeededRandom,
  overrides: Record<string, unknown> = {},
): GltfMaterial => ({
  pbrMetallicRoughness: {
    baseColorFactor: rgba(random),
    metallicFactor: unit(random),
    roughnessFactor: unit(random),
  },
  ...overrides,
});

const withPbr = (
  material: GltfMaterial,
  pbr: Record<string, unknown>,
): GltfMaterial => ({
  ...material,
  pbrMetallicRoughness: {
    ...(material.pbrMetallicRoughness as Record<string, unknown>),
    ...pbr,
  },
});

const withExtension = (
  material: GltfMaterial,
  name: string,
  value: Record<string, unknown>,
): GltfMaterial => ({
  ...material,
  extensions: {
    ...(material.extensions as Record<string, unknown> | undefined),
    [name]: value,
  },
});

const scalarExtensionPair = (
  random: SeededRandom,
  extension: string,
  field: string,
): readonly [GltfMaterial, GltfMaterial] => {
  const first = unit(random);
  const base = pbrMaterial(random);

  return [
    withExtension(base, extension, { [field]: first }),
    withExtension(base, extension, { [field]: shiftedUnit(first) }),
  ];
};

const batchDimensions = [
  {
    name: "base color factor",
    pair: (random) => {
      const first = rgba(random);
      const base = pbrMaterial(random);

      return [
        withPbr(base, { baseColorFactor: first }),
        withPbr(base, { baseColorFactor: shiftedRgba(first) }),
      ];
    },
  },
  {
    name: "metallic factor",
    pair: (random) => {
      const first = unit(random);
      const base = pbrMaterial(random);

      return [
        withPbr(base, { metallicFactor: first }),
        withPbr(base, { metallicFactor: shiftedUnit(first) }),
      ];
    },
  },
  {
    name: "roughness factor",
    pair: (random) => {
      const first = unit(random);
      const base = pbrMaterial(random);

      return [
        withPbr(base, { roughnessFactor: first }),
        withPbr(base, { roughnessFactor: shiftedUnit(first) }),
      ];
    },
  },
  {
    name: "emissive factor",
    pair: (random) => {
      const first = rgba(random);
      const base = pbrMaterial(random);

      return [
        { ...base, emissiveFactor: first },
        { ...base, emissiveFactor: shiftedRgba(first) },
      ];
    },
  },
  {
    name: "alpha mode",
    pair: (random) => {
      const base = pbrMaterial(random);

      return [
        { ...base, alphaMode: "OPAQUE" },
        { ...base, alphaMode: "BLEND" },
      ];
    },
  },
  {
    name: "alpha cutoff",
    pair: (random) => {
      const first = unit(random);
      const base = pbrMaterial(random);

      return [
        { ...base, alphaCutoff: first, alphaMode: "MASK" },
        { ...base, alphaCutoff: shiftedUnit(first), alphaMode: "MASK" },
      ];
    },
  },
  {
    name: "sidedness",
    pair: (random) => {
      const base = pbrMaterial(random);

      return [
        { ...base, doubleSided: false },
        { ...base, doubleSided: true },
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_anisotropy"],
    name: "anisotropy strength",
    pair: (random) => scalarExtensionPair(random, "KHR_materials_anisotropy", "anisotropyStrength"),
  },
  {
    extensionsUsed: ["KHR_materials_anisotropy"],
    name: "anisotropy rotation",
    pair: (random) => scalarExtensionPair(random, "KHR_materials_anisotropy", "anisotropyRotation"),
  },
  {
    extensionsUsed: ["KHR_materials_diffuse_transmission"],
    name: "diffuse transmission color",
    pair: (random) => {
      const first = vec3(random);
      const base = pbrMaterial(random);

      return [
        withExtension(base, "KHR_materials_diffuse_transmission", { diffuseTransmissionColorFactor: first }),
        withExtension(base, "KHR_materials_diffuse_transmission", {
          diffuseTransmissionColorFactor: shiftedVec3(first),
        }),
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_diffuse_transmission"],
    name: "diffuse transmission factor",
    pair: (random) =>
      scalarExtensionPair(random, "KHR_materials_diffuse_transmission", "diffuseTransmissionFactor"),
  },
  {
    extensionsUsed: ["KHR_materials_specular"],
    name: "specular color",
    pair: (random) => {
      const first = vec3(random);
      const base = pbrMaterial(random);

      return [
        withExtension(base, "KHR_materials_specular", { specularColorFactor: first }),
        withExtension(base, "KHR_materials_specular", { specularColorFactor: shiftedVec3(first) }),
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_clearcoat"],
    name: "clearcoat roughness",
    pair: (random) => scalarExtensionPair(random, "KHR_materials_clearcoat", "clearcoatRoughnessFactor"),
  },
  {
    extensionsUsed: ["KHR_materials_sheen"],
    name: "sheen color",
    pair: (random) => {
      const first = vec3(random);
      const base = pbrMaterial(random);

      return [
        withExtension(base, "KHR_materials_sheen", { sheenColorFactor: first }),
        withExtension(base, "KHR_materials_sheen", { sheenColorFactor: shiftedVec3(first) }),
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_iridescence"],
    name: "iridescence factor",
    pair: (random) => {
      const first = unit(random);
      const base = pbrMaterial(random);

      return [
        withExtension(base, "KHR_materials_iridescence", { iridescenceFactor: first }),
        withExtension(base, "KHR_materials_iridescence", { iridescenceFactor: shiftedUnit(first) }),
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_iridescence"],
    name: "iridescence thickness",
    pair: (random) => {
      const first = round(random.number(120, 320));
      const base = pbrMaterial(random);

      return [
        withExtension(base, "KHR_materials_iridescence", {
          iridescenceFactor: 0.5,
          iridescenceThicknessMaximum: first,
        }),
        withExtension(base, "KHR_materials_iridescence", {
          iridescenceFactor: 0.5,
          iridescenceThicknessMaximum: first + 180,
        }),
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_transmission"],
    name: "transmission factor",
    pair: (random) => scalarExtensionPair(random, "KHR_materials_transmission", "transmissionFactor"),
  },
  {
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume"],
    name: "attenuation color",
    pair: (random) => {
      const first = vec3(random);
      const base = withExtension(
        pbrMaterial(random),
        "KHR_materials_transmission",
        { transmissionFactor: 0.6 },
      );

      return [
        withExtension(base, "KHR_materials_volume", { attenuationColor: first, thicknessFactor: 0.5 }),
        withExtension(base, "KHR_materials_volume", { attenuationColor: shiftedVec3(first), thicknessFactor: 0.5 }),
      ];
    },
  },
  {
    extensionsUsed: ["KHR_materials_transmission", "KHR_materials_volume", "KHR_materials_dispersion"],
    name: "dispersion factor",
    pair: (random) => {
      const base = withExtension(
        withExtension(
          pbrMaterial(random),
          "KHR_materials_transmission",
          { transmissionFactor: 0.6 },
        ),
        "KHR_materials_volume",
        { thicknessFactor: 0.5 },
      );
      const first = round(random.number(0.1, 0.9));

      return [
        withExtension(base, "KHR_materials_dispersion", { dispersion: first }),
        withExtension(base, "KHR_materials_dispersion", { dispersion: first + 0.75 }),
      ];
    },
  },
] satisfies readonly BatchDimension[];

const fakeCanvas = (
  gl: WebGL2RenderingContext,
  size: CanvasSize = defaultCanvasSize,
): FakeCanvas => {
  const target = new EventTarget();
  const canvas = {
    addEventListener: target.addEventListener.bind(target),
    get clientHeight() {
      return size.height;
    },
    get clientWidth() {
      return size.width;
    },
    getBoundingClientRect: vi.fn(() => ({
      bottom: size.height,
      height: size.height,
      left: 0,
      right: size.width,
      top: 0,
      width: size.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })),
    getContext: vi.fn((contextId: string) => (contextId === "webgl2" ? gl : null)),
    height: 0,
    removeEventListener: target.removeEventListener.bind(target),
    width: 0,
  };

  (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniforms = new Map<string, WebGLUniformLocation>();
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_ATTACHMENT: 0x8D00,
    DEPTH_COMPONENT24: 0x81A6,
    DEPTH_TEST: 0x0B71,
    DYNAMIC_DRAW: 0x88E8,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8D40,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    FRAGMENT_SHADER: 0x8B30,
    HALF_FLOAT: 0x140B,
    LEQUAL: 0x0203,
    LESS: 0x0201,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    RGBA16F: 0x881A,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    SRC_ALPHA: 0x0302,
    SCISSOR_TEST: 0x0C11,
    STATIC_DRAW: 0x88E4,
    RENDERBUFFER: 0x8D41,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MAX_LEVEL: 0x813D,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
  } as const;

  const handle = <Handle>(kind: string): Handle =>
    ({ id: nextHandleId++, kind }) as Handle;

  const uniform = (name: string): WebGLUniformLocation => {
    const existing = uniforms.get(name);
    if (existing !== undefined) return existing;

    const location = { kind: "uniform", name } as unknown as WebGLUniformLocation;
    uniforms.set(name, location);

    return location;
  };

  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    calls.push({ args, name });

    return implementation?.(...args);
  });

  const glTarget = {
    ...constants,
    drawingBufferHeight: defaultCanvasSize.height,
    drawingBufferWidth: defaultCanvasSize.width,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindFramebuffer: record("bindFramebuffer"),
    bindRenderbuffer: record("bindRenderbuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendEquationSeparate: record("blendEquationSeparate"),
    blendFuncSeparate: record("blendFuncSeparate"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    copyTexSubImage2D: record("copyTexSubImage2D"),
    createBuffer: record("createBuffer", () => handle<WebGLBuffer>("buffer")),
    createFramebuffer: record("createFramebuffer", () => handle<WebGLFramebuffer>("framebuffer")),
    createProgram: record("createProgram", () => handle<WebGLProgram>("program")),
    createRenderbuffer: record("createRenderbuffer", () => handle<WebGLRenderbuffer>("renderbuffer")),
    createShader: record("createShader", () => handle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => handle<WebGLTexture>("texture")),
    createVertexArray: record("createVertexArray", () => handle<WebGLVertexArrayObject>("vertex-array")),
    cullFace: record("cullFace"),
    deleteBuffer: record("deleteBuffer"),
    deleteFramebuffer: record("deleteFramebuffer"),
    deleteProgram: record("deleteProgram"),
    deleteRenderbuffer: record("deleteRenderbuffer"),
    deleteShader: record("deleteShader"),
    detachShader: record("detachShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawArrays: record("drawArrays"),
    drawArraysInstanced: record("drawArraysInstanced"),
    drawElements: record("drawElements"),
    drawElementsInstanced: record("drawElementsInstanced"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    framebufferRenderbuffer: record("framebufferRenderbuffer"),
    framebufferTexture2D: record("framebufferTexture2D"),
    frontFace: record("frontFace"),
    getActiveAttrib: record("getActiveAttrib", () => null),
    getActiveUniform: record("getActiveUniform", () => null),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("position")) return 0;
      if (normalized.includes("normal")) return 1;
      if (normalized.includes("uv") || normalized.includes("texcoord")) return 2;

      return 0;
    }),
    getContextAttributes: record("getContextAttributes", () => ({
      alpha: true,
      antialias: true,
      depth: true,
      desynchronized: false,
      failIfMajorPerformanceCaveat: false,
      powerPreference: "default",
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      stencil: false,
    })),
    getError: record("getError", () => 0),
    getExtension: record("getExtension", (name: string) =>
      name === "EXT_color_buffer_float" ? {} : null),
    checkFramebufferStatus: record("checkFramebufferStatus", () => constants.FRAMEBUFFER_COMPLETE),
    getParameter: record<[number]>("getParameter", (parameter) => {
      if (parameter === constants.MAX_TEXTURE_IMAGE_UNITS) return 16;
      if (parameter === constants.MAX_TEXTURE_SIZE) return 4096;

      return 0;
    }),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.LINK_STATUS) return true;
      if (parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS) return 0;

      return true;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) => {
      if (parameter === constants.COMPILE_STATUS) return true;

      return true;
    }),
    getSupportedExtensions: record("getSupportedExtensions", () => []),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniform(name)),
    isContextLost: record("isContextLost", () => false),
    lineWidth: record("lineWidth"),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    polygonOffset: record("polygonOffset"),
    renderbufferStorage: record("renderbufferStorage"),
    scissor: record("scissor"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    uniform1f: record("uniform1f"),
    uniform1i: record("uniform1i"),
    uniform2f: record("uniform2f"),
    uniform2fv: record("uniform2fv"),
    uniform3fv: record("uniform3fv"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix3fv: record("uniformMatrix3fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    vertexAttrib2f: record("vertexAttrib2f"),
    vertexAttrib4f: record("vertexAttrib4f"),
    vertexAttribDivisor: record("vertexAttribDivisor"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  };

  const gl = glTarget as unknown as WebGL2RenderingContext;

  return { calls, gl };
};

const camera = () => orthographicCamera({
  bottom: -1,
  far: 20,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

const renderScene = (children: readonly RenderNode[]): RenderRoot =>
  scene({
    camera: camera(),
    nodes: children,
    clearColor: [0, 0, 0, 0],
  });

const drawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call, index) =>
    call.name === "drawElements"
    || (call.name === "drawArrays"
      && !(calls[index - 1]?.name === "bindVertexArray" && calls[index - 1]?.args[0] === null))
  );

const instancedDrawCalls = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "drawArraysInstanced" || call.name === "drawElementsInstanced");

const drawCount = (call: GlCall): number =>
  call.name === "drawArrays" ? Number(call.args[2]) : Number(call.args[1]);

const instancedDrawInstanceCount = (call: GlCall): number =>
  call.name === "drawArraysInstanced" ? Number(call.args[3]) : Number(call.args[4]);

const triangleBin = (): ArrayBuffer => {
  const buffer = new ArrayBuffer(triangleBinByteLength);

  new Float32Array(buffer, 0, 9).set([
    0, 0.5, 0,
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
  ]);
  new Float32Array(buffer, 36, 9).set([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  new Float32Array(buffer, 72, 6).set([
    0.5, 1.5,
    0, 1,
    1, 1,
  ]);
  new Uint16Array(buffer, 96, 3).set([0, 1, 2]);

  return buffer;
};

const solidTriangleDocument = () => ({
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 3,
      max: [0.5, 0.5, 0],
      min: [-0.5, -0.5, 0],
      type: "VEC3",
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    },
    {
      bufferView: 2,
      componentType: 5126,
      count: 3,
      type: "VEC2",
    },
    {
      bufferView: 3,
      componentType: 5123,
      count: 3,
      type: "SCALAR",
    },
  ],
  asset: { version: "2.0" },
  bufferViews: [
    {
      buffer: 0,
      byteLength: 36,
      byteOffset: 0,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 36,
      byteOffset: 36,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 24,
      byteOffset: 72,
      target: 34962,
    },
    {
      buffer: 0,
      byteLength: 6,
      byteOffset: 96,
      target: 34963,
    },
  ],
  buffers: [
    {
      byteLength: triangleBinByteLength,
      uri: triangleBinUri,
    },
  ],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.5, 0.5, 0.5, 1],
      },
    },
  ],
  meshes: [
    {
      primitives: [
        {
          attributes: {
            NORMAL: 1,
            POSITION: 0,
            TEXCOORD_0: 2,
          },
          indices: 3,
          material: 0,
          mode: 4,
        },
      ],
    },
  ],
  nodes: [
    {
      mesh: 0,
    },
  ],
  scene: 0,
  scenes: [
    {
      nodes: [0],
    },
  ],
});

const batchingDocument = (
  materials: readonly GltfMaterial[],
  extensionsUsed: readonly string[] = [],
) => {
  const base = solidTriangleDocument();
  const primitive = base.meshes[0]!.primitives[0]!;

  return {
    ...base,
    ...(extensionsUsed.length === 0
      ? {}
      : {
          extensionsRequired: extensionsUsed,
          extensionsUsed,
        }),
    materials,
    meshes: [
      {
        primitives: materials.map((_material, index) => ({
          ...primitive,
          material: index,
        })),
      },
    ],
  };
};

const responseWithJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

const responseWithBuffer = (body: ArrayBuffer): Response =>
  new Response(body, {
    headers: { "content-type": "application/octet-stream" },
    status: 200,
  });

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof input === "object" && input !== null && "url" in input && typeof input.url === "string") {
    return input.url;
  }

  return String(input);
};

const installViewportStubs = (): void => {
  class TestResizeObserver {
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
  }

  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

const installGltfResponses = (document: unknown): void => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (/\.gltf(?:$|[?#])/.test(url)) return Promise.resolve(responseWithJson(document));
    if (/\.bin(?:$|[?#])/.test(url)) return Promise.resolve(responseWithBuffer(triangleBin()));

    return Promise.reject(new Error(`Unexpected batching test fetch: ${url}`));
  }));
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

const renderReadyCalls = async (
  materials: readonly GltfMaterial[],
  extensionsUsed: readonly string[],
): Promise<{ readonly calls: readonly GlCall[]; readonly gl: WebGL2RenderingContext }> => {
  installViewportStubs();
  installGltfResponses(batchingDocument(materials, extensionsUsed));
  const { calls, gl } = fakeGl();
  const root = createWebGlRoot(fakeCanvas(gl));
  const renderGraph = renderScene([
    directionalLight({
      color: [1, 1, 1, 1],
      direction: [0, 0, -1],
    }),
    gltf({
      src: batchingGltfSrc,
      version: "batch-property",
    }),
  ]);

  root.render(renderGraph);

  let readyFrameCalls: readonly GlCall[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await flushMicrotasks();
    const callsBeforeRender = calls.length;
    root.render(renderGraph);
    readyFrameCalls = calls.slice(callsBeforeRender);
    if (drawCalls(readyFrameCalls).length + instancedDrawCalls(readyFrameCalls).length > 0) break;
  }

  root.dispose();

  return { calls: readyFrameCalls, gl };
};

const expectInstancedBatch = (
  result: { readonly calls: readonly GlCall[]; readonly gl: WebGL2RenderingContext },
  label: string,
): void => {
  const instancedDraws = instancedDrawCalls(result.calls);

  expect(drawCalls(result.calls), label).toHaveLength(0);
  expect(instancedDraws, label).toHaveLength(1);
  expect(instancedDraws[0]?.name, label).toBe("drawElementsInstanced");
  expect(instancedDraws[0]?.args[0], label).toBe(result.gl.TRIANGLES);
  expect(instancedDraws[0] === undefined ? 0 : instancedDrawInstanceCount(instancedDraws[0]), label).toBe(2);
};

const expectSplitDraws = (
  result: { readonly calls: readonly GlCall[]; readonly gl: WebGL2RenderingContext },
  label: string,
): void => {
  const draws = drawCalls(result.calls);

  expect(instancedDrawCalls(result.calls), label).toHaveLength(0);
  expect(draws, label).toHaveLength(2);
  expect(draws.every((call) => call.args[0] === result.gl.TRIANGLES && drawCount(call) === 3), label).toBe(true);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL renderer batching properties", () => {
  it("instances equivalent glTF primitive draws and splits changed render-state dimensions", async () => {
    await forEachFuzzCaseAsync({
      cases: batchDimensions.length,
      seed: 0xba7c_4110,
    }, async ({ caseIndex, label, random }) => {
      const dimension = batchDimensions[caseIndex % batchDimensions.length]!;
      const [first, second] = dimension.pair(random);
      const extensionsUsed = dimension.extensionsUsed ?? [];
      const equivalent = await renderReadyCalls([first, first], extensionsUsed);
      const split = await renderReadyCalls([first, second], extensionsUsed);
      const caseLabel = `${label} dimension=${dimension.name}`;

      expectInstancedBatch(equivalent, `${caseLabel} equivalent`);
      expectSplitDraws(split, `${caseLabel} split`);
    });
  });
});
