import type { GltfAnimation, GltfAssetBounds, GltfAssetRef } from './gltf';
import type { PickingId } from './picking';
import type { UiNodeSemantics } from './ui';

export interface GltfInstanceTransforms {
  readonly count: number;
  readonly poseVersion: number;
  readonly positions: Float32Array;
  readonly rotations: Float32Array;
  readonly scaleVersion: number;
  readonly scales: Float32Array;
  /** Notify attached renderer roots after mutating positions or rotations. */
  commitPose(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating scales. Negative scales are unsupported. */
  commitScale(startIndex?: number, count?: number): void;
}

export interface CreateGltfInstanceTransformsOptions {
  readonly count: number;
  readonly positions?: ArrayLike<number>;
  readonly rotations?: ArrayLike<number>;
  readonly scales?: ArrayLike<number>;
}

type GltfInstanceTransformsListener = () => void;

const listenersSymbol: unique symbol = Symbol('royal.gltfInstanceTransformsListeners');

type MutableGltfInstanceTransforms = GltfInstanceTransforms & {
  readonly [listenersSymbol]: Set<GltfInstanceTransformsListener>;
};

const positiveCount = (count: number): number => {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`glTF instance transform count must be a positive integer; received ${String(count)}`);
  }
  return count;
};

const copyChannel = (
  source: ArrayLike<number> | undefined,
  count: number,
  fallback: number,
  label: string,
): Float32Array => {
  const length = count * 3;
  if (source !== undefined && source.length !== length) {
    throw new Error(`glTF instance ${label} must contain ${length} numbers; received ${source.length}`);
  }
  const channel = new Float32Array(length);
  if (source === undefined) {
    if (fallback !== 0) channel.fill(fallback);
  } else {
    channel.set(source);
  }
  return channel;
};

const committedRange = (
  total: number,
  startIndex: number | undefined,
  count: number | undefined,
): readonly [start: number, count: number] => {
  const start = startIndex ?? 0;
  const committedCount = count ?? total - start;
  if (
    !Number.isInteger(start)
    || !Number.isInteger(committedCount)
    || start < 0
    || committedCount < 1
    || start + committedCount > total
  ) {
    throw new Error(
      `glTF instance commit range must be within 0..${total}; received start=${String(start)} count=${String(committedCount)}`,
    );
  }
  return [start, committedCount];
};

const notify = (transforms: MutableGltfInstanceTransforms): void => {
  for (const listener of transforms[listenersSymbol]) listener();
};

const validateScales = (scales: Float32Array, startOffset = 0, endOffset = scales.length): void => {
  for (let index = startOffset; index < endOffset; index += 1) {
    if (!(scales[index]! >= 0)) {
      throw new Error(`glTF instance scales must be non-negative; received ${String(scales[index])}`);
    }
  }
};

export const createGltfInstanceTransforms = (
  options: CreateGltfInstanceTransformsOptions,
): GltfInstanceTransforms => {
  const count = positiveCount(options.count);
  const listeners = new Set<GltfInstanceTransformsListener>();
  let poseVersion = 1;
  let scaleVersion = 1;
  const positions = copyChannel(options.positions, count, 0, 'positions');
  const rotations = copyChannel(options.rotations, count, 0, 'rotations');
  const scales = copyChannel(options.scales, count, 1, 'scales');
  validateScales(scales);
  const transforms: MutableGltfInstanceTransforms = {
    [listenersSymbol]: listeners,
    count,
    commitPose: (startIndex, committedCount) => {
      committedRange(count, startIndex, committedCount);
      poseVersion += 1;
      notify(transforms);
    },
    commitScale: (startIndex, committedCount) => {
      const [start, rangeCount] = committedRange(count, startIndex, committedCount);
      const startOffset = start * 3;
      const endOffset = (start + rangeCount) * 3;
      validateScales(scales, startOffset, endOffset);
      scaleVersion += 1;
      notify(transforms);
    },
    get poseVersion() {
      return poseVersion;
    },
    positions,
    rotations,
    get scaleVersion() {
      return scaleVersion;
    },
    scales,
  };
  return transforms;
};

export const subscribeGltfInstanceTransforms = (
  transforms: GltfInstanceTransforms,
  listener: GltfInstanceTransformsListener,
): (() => void) => {
  const mutable = transforms as Partial<MutableGltfInstanceTransforms>;
  const listeners = mutable[listenersSymbol];
  if (listeners === undefined) {
    throw new Error('glTF instance transforms must be created with createGltfInstanceTransforms()');
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export interface GltfInstancesNode {
  readonly animation?: GltfAnimation;
  readonly asset: GltfAssetRef;
  readonly instances: GltfInstanceTransforms;
  readonly kind: 'gltf-instances';
  readonly pickingId?: PickingId;
  readonly semantics?: UiNodeSemantics;
  readonly src: string;
  /** Selected `KHR_materials_variants` variant name or index. */
  readonly variant?: number | string;
}

export interface GltfInstancesOptions {
  readonly animation?: GltfAnimation;
  readonly bounds?: GltfAssetBounds;
  readonly instances: GltfInstanceTransforms;
  readonly pickingId?: PickingId;
  readonly semantics?: UiNodeSemantics;
  readonly src: string;
  readonly variant?: number | string;
  readonly version?: GltfAssetRef['version'];
}

export const gltfInstances = (options: GltfInstancesOptions): GltfInstancesNode => {
  const asset: GltfAssetRef = {
    ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
    uri: options.src,
    ...(options.version === undefined ? {} : { version: options.version }),
  };
  return {
    ...(options.animation === undefined
      ? {}
      : {
        animation: {
          ...(options.animation.clip === undefined ? {} : { clip: options.animation.clip }),
          timeSeconds: options.animation.timeSeconds,
        },
      }),
    asset,
    instances: options.instances,
    kind: 'gltf-instances',
    ...(options.pickingId === undefined ? {} : { pickingId: options.pickingId }),
    ...(options.semantics === undefined ? {} : { semantics: options.semantics }),
    src: asset.uri,
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  };
};
