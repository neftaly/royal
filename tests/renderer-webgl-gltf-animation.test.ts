import { describe, expect, it } from "vitest";
import {
  gltfAnimationNodeTransformsAt,
  readGltfAnimationClips,
  selectGltfAnimationClip,
} from "../packages/renderer-webgl/src/gltf/animation";
import type { GltfDocument } from "../packages/renderer-webgl/src/gltf/schema";

const arrayBufferFromFloats = (values: readonly number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(values.length * Float32Array.BYTES_PER_ELEMENT);
  new Float32Array(buffer).set(values);

  return buffer;
};

const animationDocument = (): { readonly buffers: readonly ArrayBuffer[]; readonly document: GltfDocument } => {
  const times = [0, 1, 2];
  const translations = [
    0, 0, 0,
    2, 0, 0,
    4, 2, 0,
  ];
  const stepScales = [
    1, 1, 1,
    2, 2, 2,
    3, 3, 3,
  ];
  const rotations = [
    0, 0, 0, 1,
    0, 0, -Math.SQRT1_2, -Math.SQRT1_2,
  ];
  const buffers = [
    arrayBufferFromFloats(times),
    arrayBufferFromFloats(translations),
    arrayBufferFromFloats(stepScales),
    arrayBufferFromFloats([0, 1]),
    arrayBufferFromFloats(rotations),
  ];

  return {
    buffers,
    document: {
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "SCALAR" },
        { bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 2, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 3, componentType: 5126, count: 2, type: "SCALAR" },
        { bufferView: 4, componentType: 5126, count: 2, type: "VEC4" },
      ],
      animations: [
        {
          channels: [],
          name: "empty",
          samplers: [],
        },
        {
          channels: [
            { sampler: 0, target: { node: 1, path: "translation" } },
            { sampler: 1, target: { node: 1, path: "scale" } },
          ],
          name: "move",
          samplers: [
            { input: 0, interpolation: "LINEAR", output: 1 },
            { input: 0, interpolation: "STEP", output: 2 },
          ],
        },
        {
          channels: [
            { sampler: 0, target: { node: 2, path: "rotation" } },
          ],
          name: "turn",
          samplers: [
            { input: 3, output: 4 },
          ],
        },
      ],
      bufferViews: [
        { buffer: 0, byteLength: times.length * 4 },
        { buffer: 1, byteLength: translations.length * 4 },
        { buffer: 2, byteLength: stepScales.length * 4 },
        { buffer: 3, byteLength: 2 * 4 },
        { buffer: 4, byteLength: rotations.length * 4 },
      ],
    },
  };
};

const round = (values: readonly number[]): readonly number[] =>
  values.map((value) => Number(value.toFixed(6)));

describe("renderer-webgl glTF animation helpers", () => {
  it("selects clips and evaluates node TRS channels", () => {
    const { buffers, document } = animationDocument();
    const clips = readGltfAnimationClips(document, buffers);
    expect(clips.map((candidate) => [candidate.index, candidate.name])).toEqual([[1, "move"], [2, "turn"]]);
    expect(selectGltfAnimationClip(clips, 1)?.name).toBe("move");
    const clip = selectGltfAnimationClip(clips, "move");
    expect(clip?.durationSeconds).toBe(2);

    const transforms = clip === undefined ? new Map() : gltfAnimationNodeTransformsAt(clip, 1.5);
    expect(round(transforms.get(1)?.translation ?? [])).toEqual([3, 1, 0]);
    expect(round(transforms.get(1)?.scale ?? [])).toEqual([2, 2, 2]);
  });

  it("normalizes sampled rotations and clamps beyond clip bounds", () => {
    const { buffers, document } = animationDocument();
    const clips = readGltfAnimationClips(document, buffers);
    const clip = selectGltfAnimationClip(clips, 2);

    const transforms = clip === undefined ? new Map() : gltfAnimationNodeTransformsAt(clip, 4);
    expect(round(transforms.get(2)?.rotation ?? [])).toEqual([0, 0, -0.707107, -0.707107]);
  });

  it("uses quaternion interpolation for linear rotations", () => {
    const { buffers, document } = animationDocument();
    const clips = readGltfAnimationClips(document, buffers);
    const clip = selectGltfAnimationClip(clips, 2);

    const transforms = clip === undefined ? new Map() : gltfAnimationNodeTransformsAt(clip, 0.5);
    expect(round(transforms.get(2)?.rotation ?? [])).toEqual([0, 0, 0.382683, 0.92388]);
  });
});
