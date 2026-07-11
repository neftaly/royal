import {
  resolveGltfAsset,
  validateGltfVariant,
  type GltfAssetBounds,
  type GltfAssetRef,
} from './gltf';
import type { PickingId } from './picking';

export interface GltfInstanceTransforms {
  readonly count: number;
  /** Stable application identities. Their order is immutable for this source's lifetime. */
  readonly logicalIds?: readonly PickingId[];
  readonly poseVersion: number;
  readonly positions: Float32Array;
  readonly rotations: Float32Array;
  readonly scaleVersion: number;
  readonly scales: Float32Array;
  /** Notify attached renderer roots after mutating positions or rotations. */
  commitPose(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating scales. Negative scales are unsupported. */
  commitScale(startIndex?: number, count?: number): void;
  /** Observe committed logical ranges. Each renderer owns its own consumption state. */
  subscribe(listener: GltfInstanceTransformsListener): () => void;
}

export type GltfInstanceTransformChannel = 'pose' | 'scale';

export type GltfInstanceTransformsListener = (
  channel: GltfInstanceTransformChannel,
  startIndex: number,
  count: number,
  version: number,
) => void;

export interface CreateGltfInstanceTransformsOptions {
  readonly count: number;
  readonly logicalIds?: readonly PickingId[];
  readonly positions?: ArrayLike<number>;
  readonly rotations?: ArrayLike<number>;
  readonly scales?: ArrayLike<number>;
}

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

const assertCommittedRange = (
  total: number,
  startIndex: number | undefined,
  count: number | undefined,
): void => {
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
};

const validateFiniteChannel = (
  values: Float32Array,
  label: string,
  startOffset = 0,
  endOffset = values.length,
): void => {
  for (let index = startOffset; index < endOffset; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new Error(`glTF instance ${label} must be finite; received ${String(values[index])}`);
    }
  }
};

const validateScales = (scales: Float32Array, startOffset = 0, endOffset = scales.length): void => {
  for (let index = startOffset; index < endOffset; index += 1) {
    if (!Number.isFinite(scales[index]) || !(scales[index]! >= 0)) {
      throw new Error(`glTF instance scales must be finite and non-negative; received ${String(scales[index])}`);
    }
  }
};

const logicalIdsFrom = (
  logicalIds: readonly PickingId[] | undefined,
  count: number,
): readonly PickingId[] | undefined => {
  if (logicalIds === undefined) return undefined;
  if (logicalIds.length !== count) {
    throw new Error(`glTF instance logicalIds must contain ${count} strings; received ${logicalIds.length}`);
  }
  const copy = [...logicalIds];
  if (copy.some((logicalId) => typeof logicalId !== 'string')) {
    throw new Error('glTF instance logicalIds must contain only strings');
  }
  const unique = new Set(copy);
  if (unique.size !== copy.length) throw new Error('glTF instance logicalIds must be unique');
  return Object.freeze(copy);
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
  const logicalIds = logicalIdsFrom(options.logicalIds, count);
  validateFiniteChannel(positions, 'positions');
  validateFiniteChannel(rotations, 'rotations');
  validateScales(scales);
  const transforms: GltfInstanceTransforms = {
    count,
    ...(logicalIds === undefined ? {} : { logicalIds }),
    commitPose: (startIndex, committedCount) => {
      assertCommittedRange(count, startIndex, committedCount);
      const start = startIndex ?? 0;
      const rangeCount = committedCount ?? count - start;
      const startOffset = start * 3;
      const endOffset = (start + rangeCount) * 3;
      validateFiniteChannel(positions, 'positions', startOffset, endOffset);
      validateFiniteChannel(rotations, 'rotations', startOffset, endOffset);
      poseVersion += 1;
      for (const listener of listeners) listener('pose', start, rangeCount, poseVersion);
    },
    commitScale: (startIndex, committedCount) => {
      assertCommittedRange(count, startIndex, committedCount);
      const start = startIndex ?? 0;
      const rangeCount = committedCount ?? count - start;
      const startOffset = start * 3;
      const endOffset = (start + rangeCount) * 3;
      validateScales(scales, startOffset, endOffset);
      scaleVersion += 1;
      for (const listener of listeners) listener('scale', start, rangeCount, scaleVersion);
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
    subscribe: (listener) => {
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
  };
  return Object.freeze(transforms);
};

export interface GltfInstancesNode {
  readonly asset: GltfAssetRef;
  readonly instances: GltfInstanceTransforms;
  readonly kind: 'gltf-instances';
  readonly pickingId?: PickingId;
  readonly src: string;
  /** Selected `KHR_materials_variants` variant name or index. */
  readonly variant?: number | string;
}

export interface GltfInstancesOptions {
  readonly bounds?: GltfAssetBounds;
  readonly instances: GltfInstanceTransforms;
  readonly pickingId?: PickingId;
  readonly src: string;
  readonly variant?: number | string;
  readonly version?: GltfAssetRef['version'];
}

export const gltfInstances = (options: GltfInstancesOptions): GltfInstancesNode => {
  const asset = resolveGltfAsset(options);
  const variant = validateGltfVariant(options.variant);
  return Object.freeze({
    asset,
    instances: options.instances,
    kind: 'gltf-instances',
    ...(options.pickingId === undefined ? {} : { pickingId: options.pickingId }),
    src: asset.uri,
    ...(variant === undefined ? {} : { variant }),
  });
};
