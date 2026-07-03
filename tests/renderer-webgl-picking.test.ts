import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";

type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

type FakeCanvas = HTMLCanvasElement & {
  getContext: ReturnType<typeof vi.fn>;
};

const handle = <Handle>(): Handle => ({} as Handle);

const fakeCanvas = (
  gl: WebGL2RenderingContext,
  size: CanvasSize = { height: 200, width: 400 },
): FakeCanvas => {
  const canvas = {
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
    width: 0,
  };

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (): WebGL2RenderingContext => {
  const uniform = handle<WebGLUniformLocation>();
  const noop = vi.fn(() => undefined);

  return {
    ACTIVE_TEXTURE: 0x84E0,
    ARRAY_BUFFER: 0x8892,
    BACK: 0x0405,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    CULL_FACE: 0x0B44,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8B82,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    STATIC_DRAW: 0x88E4,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MAX_LEVEL: 0x813D,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_INT: 0x1405,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
    activeTexture: noop,
    attachShader: noop,
    bindAttribLocation: noop,
    bindBuffer: noop,
    bindTexture: noop,
    blendFunc: noop,
    bufferData: noop,
    clear: noop,
    clearColor: noop,
    clearDepth: noop,
    compileShader: noop,
    createBuffer: vi.fn(() => handle<WebGLBuffer>()),
    createProgram: vi.fn(() => handle<WebGLProgram>()),
    createShader: vi.fn(() => handle<WebGLShader>()),
    createTexture: vi.fn(() => handle<WebGLTexture>()),
    cullFace: noop,
    deleteBuffer: noop,
    deleteProgram: noop,
    deleteShader: noop,
    deleteTexture: noop,
    depthFunc: noop,
    depthMask: noop,
    disable: noop,
    disableVertexAttribArray: noop,
    drawArrays: noop,
    drawElements: noop,
    enable: noop,
    enableVertexAttribArray: noop,
    getAttribLocation: vi.fn((_: WebGLProgram, name: string) => name === "a_position" ? 0 : -1),
    getError: vi.fn(() => 0),
    getParameter: vi.fn(() => 4096),
    getProgramInfoLog: vi.fn(() => ""),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => uniform),
    linkProgram: noop,
    pixelStorei: noop,
    shaderSource: noop,
    texImage2D: noop,
    texParameteri: noop,
    texStorage2D: noop,
    uniform1i: noop,
    uniform3f: noop,
    uniform3fv: noop,
    uniform4fv: noop,
    uniformMatrix4fv: noop,
    useProgram: noop,
    vertexAttribPointer: noop,
    viewport: noop,
  } as unknown as WebGL2RenderingContext;
};

const loadedTriangleGltfFetch = (): ReturnType<typeof vi.fn> => {
  const positions = new Float32Array([
    -0.35, -0.35, 0,
    0.35, -0.35, 0,
    0, 0.35, 0,
  ]);
  const buffer = positions.buffer.slice(0);

  return vi.fn(async (url: string) => {
    if (url === "/models/right.gltf") {
      return {
        json: async () => ({
          accessors: [
            {
              bufferView: 0,
              componentType: 5126,
              count: 3,
              type: "VEC3",
            },
          ],
          bufferViews: [
            {
              buffer: 0,
              byteLength: buffer.byteLength,
            },
          ],
          buffers: [
            {
              uri: "right.bin",
            },
          ],
          meshes: [
            {
              primitives: [
                {
                  attributes: {
                    POSITION: 0,
                  },
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
        }),
        ok: true,
      };
    }

    if (url === "/models/right.bin") {
      return {
        arrayBuffer: async () => buffer,
        ok: true,
      };
    }

    throw new Error(`unexpected fetch ${url}`);
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL picking", () => {
  it("returns the intended mesh or loaded glTF target for DOM client coordinates", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("fetch", loadedTriangleGltfFetch());
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const leftMesh = mesh({
      geometry: boxGeometry([0.7, 0.7, 0.7]),
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
      pickingId: "left-mesh",
      transform: {
        position: [-1, 0, 0],
        rotation: [0, 0, 0],
      },
    });
    const rightGltf = gltf({
      bounds: {
        max: [0.35, 0.35, 0.35],
        min: [-0.35, -0.35, -0.35],
      },
      pickingId: "right-gltf",
      src: "/models/right.gltf",
      transform: {
        position: [1, 0, 0],
        rotation: [0, 0, 0],
      },
    });

    root.render(scene({
      children: [
        pass({
          camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -2,
            near: 0.1,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 1,
          }),
          children: [leftMesh, rightGltf],
        }),
      ],
    }));

    expect(root.pick({ clientX: 100, clientY: 100 })?.target).toMatchObject({
      id: "left-mesh",
      kind: "mesh",
      node: leftMesh,
    });
    await vi.waitFor(() => {
      expect(root.pick({ clientX: 300, clientY: 100 })?.target).toMatchObject({
        id: "right-gltf",
        kind: "gltf",
        node: rightGltf,
      });
    });
    expect(root.pick({ clientX: 200, clientY: 10 })).toBeUndefined();
  });

  it("does not accept a mesh AABB hit unless the ray intersects rendered triangles", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const rotatedMesh = mesh({
      geometry: boxGeometry([2, 0.2, 0.2]),
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
      pickingId: "rotated-mesh",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, Math.PI / 4],
      },
    });

    root.render(scene({
      children: [
        pass({
          camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -2,
            near: 0.1,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 1,
          }),
          children: [rotatedMesh],
        }),
      ],
    }));

    expect(root.pick({ clientX: 272, clientY: 100 })).toBeUndefined();
    expect(root.pick({ clientX: 200, clientY: 100 })?.target).toMatchObject({
      id: "rotated-mesh",
      kind: "mesh",
      node: rotatedMesh,
    });
  });

  it("does not pick unloaded glTF asset bounds as a fallback", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const rotatedGltf = gltf({
      bounds: {
        max: [1, 0.1, 0.1],
        min: [-1, -0.1, -0.1],
      },
      pickingId: "rotated-gltf",
      src: "/models/rotated.gltf",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, Math.PI / 4],
      },
    });

    root.render(scene({
      children: [
        pass({
          camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -2,
            near: 0.1,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 1,
          }),
          children: [rotatedGltf],
        }),
      ],
    }));

    expect(root.pick({ clientX: 272, clientY: 100 })).toBeUndefined();
  });
});
