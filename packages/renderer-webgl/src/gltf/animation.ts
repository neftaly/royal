import { readGltfFloatAccessor } from "./accessors";
import type { GltfDocument } from "./schema";

export type GltfAnimationPath = "rotation" | "scale" | "translation";

export type GltfAnimationSelection = number | string | undefined;

export type GltfAnimatedNodeTransform = {
  readonly rotation?: readonly [number, number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly translation?: readonly [number, number, number];
};

type GltfAnimationInterpolation = "CUBICSPLINE" | "LINEAR" | "STEP";

type GltfAnimationTarget = {
  readonly components: 3 | 4;
  readonly input: Float32Array;
  readonly interpolation: GltfAnimationInterpolation;
  readonly node: number;
  readonly output: Float32Array;
  readonly path: GltfAnimationPath;
};

export type GltfAnimationClip = {
  readonly durationSeconds: number;
  readonly index: number;
  readonly name?: string;
  readonly targets: readonly GltfAnimationTarget[];
};

const isGltfAnimationPath = (value: string | undefined): value is GltfAnimationPath =>
  value === "rotation" || value === "scale" || value === "translation";

const gltfAnimationComponentCount = (path: GltfAnimationPath): 3 | 4 =>
  path === "rotation" ? 4 : 3;

const gltfAnimationInterpolation = (value: string | undefined): GltfAnimationInterpolation =>
  value === "CUBICSPLINE" || value === "STEP" ? value : "LINEAR";

const gltfAnimationDuration = (targets: readonly GltfAnimationTarget[]): number =>
  targets.reduce((duration, target) => Math.max(duration, target.input[target.input.length - 1] ?? 0), 0);

export const readGltfAnimationClips = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
): readonly GltfAnimationClip[] =>
  (document.animations ?? [])
    .map((animation, index): GltfAnimationClip | undefined => {
      const targets = (animation.channels ?? [])
        .map((channel): GltfAnimationTarget | undefined => {
          const sampler = channel.sampler === undefined ? undefined : animation.samplers?.[channel.sampler];
          const node = channel.target?.node;
          const path = channel.target?.path;
          if (
            sampler?.input === undefined
            || sampler.output === undefined
            || node === undefined
            || !Number.isInteger(node)
            || node < 0
            || !isGltfAnimationPath(path)
          ) return undefined;

          const input = readGltfFloatAccessor(document, buffers, sampler.input);
          const output = readGltfFloatAccessor(document, buffers, sampler.output);
          const components = gltfAnimationComponentCount(path);
          const interpolation = gltfAnimationInterpolation(sampler.interpolation);
          const keyframeMultiplier = interpolation === "CUBICSPLINE" ? 3 : 1;
          if (
            input.length === 0
            || output.length < input.length * components * keyframeMultiplier
          ) return undefined;

          return {
            components,
            input,
            interpolation,
            node,
            output,
            path,
          };
        })
        .filter((target): target is GltfAnimationTarget => target !== undefined);
      if (targets.length === 0) return undefined;

      return {
        durationSeconds: gltfAnimationDuration(targets),
        index,
        ...(animation.name === undefined ? {} : { name: animation.name }),
        targets,
      };
    })
    .filter((clip): clip is GltfAnimationClip => clip !== undefined);

export const selectGltfAnimationClip = (
  clips: readonly GltfAnimationClip[],
  selection: GltfAnimationSelection,
): GltfAnimationClip | undefined => {
  if (clips.length === 0) return undefined;
  if (typeof selection === "number") return clips.find((clip) => clip.index === selection);
  if (selection !== undefined) return clips.find((clip) => clip.name === selection);

  return clips[0];
};

const keyframeIndex = (times: Float32Array, timeSeconds: number): number => {
  for (let index = 0; index < times.length - 1; index += 1) {
    if (timeSeconds < (times[index + 1] ?? Infinity)) return index;
  }

  return Math.max(0, times.length - 2);
};

const outputOffset = (
  target: GltfAnimationTarget,
  keyframe: number,
  element: "inTangent" | "outTangent" | "value" = "value",
): number => {
  if (target.interpolation !== "CUBICSPLINE") return keyframe * target.components;
  const elementOffset = element === "inTangent" ? 0 : element === "value" ? 1 : 2;

  return (keyframe * 3 + elementOffset) * target.components;
};

const readSample = (
  target: GltfAnimationTarget,
  keyframe: number,
  element: "inTangent" | "outTangent" | "value" = "value",
): number[] => {
  const offset = outputOffset(target, keyframe, element);
  return Array.from({ length: target.components }, (_, component) => target.output[offset + component] ?? 0);
};

const normalizedQuaternion = (values: readonly number[]): readonly [number, number, number, number] => {
  const x = values[0] ?? 0;
  const y = values[1] ?? 0;
  const z = values[2] ?? 0;
  const w = values[3] ?? 1;
  const length = Math.hypot(x, y, z, w);
  if (length <= 0) return [0, 0, 0, 1];

  return [x / length, y / length, z / length, w / length];
};

const quaternionSlerp = (
  leftValues: readonly number[],
  rightValues: readonly number[],
  alpha: number,
): readonly [number, number, number, number] => {
  const [leftX, leftY, leftZ, leftW] = normalizedQuaternion(leftValues);
  let [rightX, rightY, rightZ, rightW] = normalizedQuaternion(rightValues);
  let dot = leftX * rightX + leftY * rightY + leftZ * rightZ + leftW * rightW;
  if (dot < 0) {
    dot = -dot;
    rightX = -rightX;
    rightY = -rightY;
    rightZ = -rightZ;
    rightW = -rightW;
  }

  if (dot > 0.9995) {
    return normalizedQuaternion([
      leftX + (rightX - leftX) * alpha,
      leftY + (rightY - leftY) * alpha,
      leftZ + (rightZ - leftZ) * alpha,
      leftW + (rightW - leftW) * alpha,
    ]);
  }

  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  if (sinTheta <= 0) return [leftX, leftY, leftZ, leftW];

  const leftWeight = Math.sin((1 - alpha) * theta) / sinTheta;
  const rightWeight = Math.sin(alpha * theta) / sinTheta;

  return normalizedQuaternion([
    leftX * leftWeight + rightX * rightWeight,
    leftY * leftWeight + rightY * rightWeight,
    leftZ * leftWeight + rightZ * rightWeight,
    leftW * leftWeight + rightW * rightWeight,
  ]);
};

const finalizeSample = (
  target: GltfAnimationTarget,
  values: readonly number[],
): readonly [number, number, number] | readonly [number, number, number, number] =>
  target.path === "rotation"
    ? normalizedQuaternion(values)
    : [
        values[0] ?? 0,
        values[1] ?? 0,
        values[2] ?? 0,
      ];

const linearSample = (
  target: GltfAnimationTarget,
  leftKeyframe: number,
  rightKeyframe: number,
  alpha: number,
): readonly [number, number, number] | readonly [number, number, number, number] => {
  const left = readSample(target, leftKeyframe);
  const right = readSample(target, rightKeyframe);
  if (target.path === "rotation") return quaternionSlerp(left, right, alpha);

  return finalizeSample(
    target,
    left.map((value, component) => value + ((right[component] ?? value) - value) * alpha),
  );
};

const cubicSplineSample = (
  target: GltfAnimationTarget,
  leftKeyframe: number,
  rightKeyframe: number,
  alpha: number,
): readonly [number, number, number] | readonly [number, number, number, number] => {
  const leftTime = target.input[leftKeyframe] ?? 0;
  const rightTime = target.input[rightKeyframe] ?? leftTime;
  const deltaTime = Math.max(0, rightTime - leftTime);
  const t2 = alpha * alpha;
  const t3 = t2 * alpha;
  const p0 = readSample(target, leftKeyframe);
  const m0 = readSample(target, leftKeyframe, "outTangent");
  const p1 = readSample(target, rightKeyframe);
  const m1 = readSample(target, rightKeyframe, "inTangent");
  return finalizeSample(
    target,
    p0.map((value, component) =>
      (2 * t3 - 3 * t2 + 1) * value
      + (t3 - 2 * t2 + alpha) * deltaTime * (m0[component] ?? 0)
      + (-2 * t3 + 3 * t2) * (p1[component] ?? value)
      + (t3 - t2) * deltaTime * (m1[component] ?? 0)),
  );
};

const sampleTarget = (
  target: GltfAnimationTarget,
  timeSeconds: number,
): readonly [number, number, number] | readonly [number, number, number, number] => {
  if (target.input.length === 1 || timeSeconds <= (target.input[0] ?? 0)) {
    return finalizeSample(target, readSample(target, 0));
  }
  const lastKeyframe = target.input.length - 1;
  if (timeSeconds >= (target.input[lastKeyframe] ?? 0)) {
    return finalizeSample(target, readSample(target, lastKeyframe));
  }

  const leftKeyframe = keyframeIndex(target.input, timeSeconds);
  const rightKeyframe = leftKeyframe + 1;
  if (target.interpolation === "STEP") return finalizeSample(target, readSample(target, leftKeyframe));

  const leftTime = target.input[leftKeyframe] ?? 0;
  const rightTime = target.input[rightKeyframe] ?? leftTime;
  const alpha = rightTime === leftTime ? 0 : (timeSeconds - leftTime) / (rightTime - leftTime);
  return target.interpolation === "CUBICSPLINE"
    ? cubicSplineSample(target, leftKeyframe, rightKeyframe, alpha)
    : linearSample(target, leftKeyframe, rightKeyframe, alpha);
};

export const gltfAnimationNodeTransformsAt = (
  clip: GltfAnimationClip,
  timeSeconds: number,
): ReadonlyMap<number, GltfAnimatedNodeTransform> => {
  const transforms = new Map<number, GltfAnimatedNodeTransform>();
  for (const target of clip.targets) {
    const sampled = sampleTarget(target, timeSeconds);
    const existing = transforms.get(target.node) ?? {};
    switch (target.path) {
      case "rotation":
        transforms.set(target.node, { ...existing, rotation: sampled as readonly [number, number, number, number] });
        break;
      case "scale":
        transforms.set(target.node, { ...existing, scale: sampled as readonly [number, number, number] });
        break;
      case "translation":
        transforms.set(target.node, { ...existing, translation: sampled as readonly [number, number, number] });
        break;
    }
  }

  return transforms;
};
