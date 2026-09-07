import {
  createCameraViewResource, gltf, orbitPerspectiveCamera, scene,
  type LinearRgba,
} from "@royal/renderer-core";
import { createRendererRoot } from "@royal/renderer-webgl";
import { multiplyMat4Into, identityMat4, projectionMat4, viewMat4 } from "../../packages/renderer-webgl/src/math/mat4";

type Mode = "near-opaque" | "fractional" | "holes" | "mixed" | "flipped-stack" | "opaque";
const modes: Mode[] = ["near-opaque", "fractional", "holes", "mixed", "flipped-stack", "opaque"];
const dataUri = (bytes: Uint8Array, mime = "application/octet-stream") =>
  `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
const over = (front: LinearRgba, back: LinearRgba): LinearRgba => [
  front[0] * front[3] + back[0] * (1 - front[3]),
  front[1] * front[3] + back[1] * (1 - front[3]),
  front[2] * front[3] + back[2] * (1 - front[3]),
  front[3] + back[3] * (1 - front[3]),
];

/** Standalone glTF fixture: no Probability, SVG importer, remote assets, or selection state. */
const fixture = (mode: Mode) => {
  const alpha = mode === "near-opaque" ? 0.99998 : mode === "opaque" ? 1 : 0.5;
  const blue: LinearRgba = [0, 0, 1, alpha];
  const red: LinearRgba = [1, 0, 0, mode === "mixed" ? 1 : alpha];
  const green: LinearRgba = [0, 1, 0, alpha];
  const yellow: LinearRgba = [1, 1, 0, mode === "mixed" ? 1 : alpha];
  const cyan: LinearRgba = [0, 1, 1, alpha];
  const colors = [blue, red, green, yellow, ...(mode === "flipped-stack" ? [cyan] : [])];
  const positions = new Float32Array([-.5, 0, -.5, -.5, 0, .5, .5, 0, .5, .5, 0, -.5]);
  const uvs = new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const binary = new Uint8Array(92);
  binary.set(new Uint8Array(positions.buffer));
  binary.set(new Uint8Array(uvs.buffer), 48);
  binary.set(new Uint8Array(indices.buffer), 80);
  const cutout = document.createElement("canvas");
  cutout.width = cutout.height = 8;
  const context = cutout.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(4, 0, 4, 8);
  const holes = mode === "holes" || mode === "mixed";
  const documentValue = {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_materials_unlit"],
    buffers: [{ byteLength: binary.length, uri: dataUri(binary) }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 32 },
      { buffer: 0, byteOffset: 80, byteLength: 12 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-.5, 0, -.5], max: [.5, 0, .5] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 2, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    ...(holes ? {
      images: [{ uri: cutout.toDataURL() }],
      samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
      textures: [{ source: 0, sampler: 0 }],
    } : {}),
    materials: colors.map((color, index) => ({
      alphaMode: mode === "opaque" || (mode === "mixed" && index === 3) ? "OPAQUE"
        : mode === "mixed" && index === 1 ? "MASK" : "BLEND",
      doubleSided: true,
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: {
        baseColorFactor: color,
        ...(holes && index === 1 ? { baseColorTexture: { index: 0 } } : {}),
      },
    })),
    meshes: colors.map((_, material) => ({ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material }] })),
    nodes: [
      { mesh: 0, translation: [0, .002, 0], scale: [.841, 1, .594] },
      { mesh: 1, translation: [-.3765, .0041, -.234], scale: [.088, 1, .126], ...(mode === "flipped-stack" ? { rotation: [1, 0, 0, 0] } : {}) },
      { mesh: 2, translation: [-.3765, .0041, -.100], scale: [.088, 1, .126] },
      { mesh: 3, translation: [.3, .0041, .2], scale: [.088, 1, .126] },
      ...(mode === "flipped-stack" ? [{ mesh: 4, translation: [-.3765, .0062, -.234], scale: [.03, 1, .05] }] : []),
    ],
    scenes: [{ nodes: colors.map((_, index) => index) }], scene: 0,
  };
  const background = over(blue, [0, 0, 0, 1]);
  return {
    node: gltf(dataUri(new TextEncoder().encode(JSON.stringify(documentValue)), "model/gltf+json")),
    samples: [
      { point: [-.3985, .0041, -.234], expected: holes ? background : over(red, background), name: "card-left" },
      { point: [-.3545, .0041, -.234], expected: over(red, background), name: "card-right" },
      { point: [-.3765, .0041, -.100], expected: over(green, background), name: "second-card" },
      { point: [.3, .0041, .2], expected: over(yellow, background), name: "near-side-card" },
      ...(mode === "flipped-stack" ? [{ point: [-.3765, .0062, -.234], expected: over(cyan, over(red, background)), name: "stack" }] : []),
    ],
  };
};

export const runAlphaBlendMatSmoke = async () => {
  const canvas = document.createElement("canvas");
  document.body.replaceChildren(canvas);
  const root = createRendererRoot(canvas, { alpha: false, antialias: false });
  root.setSize({ cssWidth: 1000, cssHeight: 800, pixelRatio: 1 });
  const gl = canvas.getContext("webgl2")!;
  const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = gl.getParameter(rendererInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) as string;
  const pixel = new Uint8Array(4);
  const results: { mode: Mode; yaw: number; pitch: number; name: string; actual: number[]; expected: number[]; error: number }[] = [];
  try {
    for (const mode of modes) {
      const { node, samples } = fixture(mode);
      const at = (pitch: number, yaw: number) => orbitPerspectiveCamera({
        view: { target: [0, 0, 0], pitch, yaw, distance: 1 },
        near: 0.01,
      });
      const camera = createCameraViewResource(at(Math.PI / 2, 0));
      root.setScene(scene({ camera, clearColor: [0, 0, 0, 1], nodes: [node] }));
      const deadline = performance.now() + 20_000;
      while (root.getGltfAssetSnapshot(node.asset).status !== "ready") {
        if (performance.now() > deadline) throw new Error(JSON.stringify(root.getGltfAssetSnapshot(node.asset)));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      for (const [pitch, yaw] of [[Math.PI / 2, 0], [.6, 0], [.6, Math.PI], [.6, -Math.PI / 2], [.6, Math.PI / 2], [.6, 0]] as const) {
        const next = at(pitch, yaw);
        camera.set(next);
        root.invalidate();
        root.flushInvalidated();
        const matrix = multiplyMat4Into(identityMat4(), projectionMat4(next, 1000, 800), viewMat4(next));
        for (const sample of samples) {
          const clip = [0, 1, 2, 3].map((row) => matrix[row]! * sample.point[0]!
            + matrix[row + 4]! * sample.point[1]! + matrix[row + 8]! * sample.point[2]! + matrix[row + 12]!);
          const x = Math.floor((clip[0]! / clip[3]! + 1) * 500);
          const y = Math.floor((clip[1]! / clip[3]! + 1) * 400);
          if (x < 0 || x >= 1000 || y < 0 || y >= 800) throw new Error("Sample outside viewport");
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          const expected = sample.expected.map((value) => Math.round(value * 255));
          const error = Math.max(...expected.map((value, index) => Math.abs(value - pixel[index]!)));
          results.push({ mode, yaw, pitch, name: sample.name, actual: [...pixel], expected, error });
        }
      }
    }
    return { renderer, results, failures: results.filter(({ error }) => error > 3) };
  } finally {
    root.dispose();
  }
};
