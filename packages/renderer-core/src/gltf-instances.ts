import {
  resolveGltfAsset,
  validateGltfMaterialVariantName,
  type GltfAssetBounds,
  type GltfAssetRef,
  type GltfMaterialVariantName,
} from './gltf';
import { resolvePickingId, type PickingId } from './picking';
import { validateGeometry, type Geometry } from './geometry';
import { objectWithAllowedFields } from './descriptor-values';

/**
 * Mutable packed-transform protocol consumed by `gltfInstances`.
 * `createGltfInstanceTransforms` is the default implementation; adapters may
 * wrap it while preserving the exact counts, typed-array channels, versions,
 * commit methods, and subscription behavior described here.
 */
export interface GltfInstanceTransforms {
  readonly count: number;
  /** Stable application identities. Their order is immutable for this source's lifetime. */
  readonly logicalIds?: readonly PickingId[];
  readonly poseVersion: number;
  /** Packed XYZ translations in metres (`count * 3`). */
  readonly positions: Float32Array;
  /** Packed XYZ Euler angles in radians (`count * 3`). */
  readonly rotations: Float32Array;
  readonly scaleVersion: number;
  /** Packed dimensionless XYZ multipliers (`count * 3`). */
  readonly scales: Float32Array;
  /** Notify attached renderer roots after mutating positions only. */
  commitPosition(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating positions or rotations. */
  commitPose(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating rotations only. */
  commitRotation(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating scales. Negative scales are unsupported. */
  commitScale(startIndex?: number, count?: number): void;
  /** Observe committed logical ranges. Each renderer owns its own consumption state. */
  subscribe(listener: GltfInstanceTransformsListener): () => void;
}

export type GltfInstanceTransformChannel = 'position' | 'pose' | 'rotation' | 'scale';

export type GltfInstanceTransformsListener = (
  channel: GltfInstanceTransformChannel,
  startIndex: number,
  count: number,
  version: number,
) => void;

export interface CreateGltfInstanceTransformsOptions {
  readonly count: number;
  readonly logicalIds?: readonly PickingId[];
  /** Packed XYZ translations in metres (`count * 3`). */
  readonly positions?: ArrayLike<number>;
  /** Packed XYZ Euler angles in radians (`count * 3`). */
  readonly rotations?: ArrayLike<number>;
  /** Packed dimensionless XYZ multipliers (`count * 3`). */
  readonly scales?: ArrayLike<number>;
}

const GLTF_INSTANCE_TRANSFORM_FIELDS = [
  'count', 'logicalIds', 'positions', 'rotations', 'scales',
] as const;

const positiveCount = (count: number): number => {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(`glTF instance transform count must be a positive safe integer; received ${String(count)}`);
  }
  return count;
};

const isFloat32Array = (value: unknown): value is Float32Array =>
  Object.prototype.toString.call(value) === '[object Float32Array]';

const validateInstanceTransforms = (value: unknown): GltfInstanceTransforms => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('glTF instances instances must be a GltfInstanceTransforms object');
  }
  const resource = value as Partial<GltfInstanceTransforms>;
  const count = positiveCount(resource.count as number);
  const channelLength = count * 3;
  for (const field of ['positions', 'rotations', 'scales'] as const) {
    const channel = resource[field];
    if (!isFloat32Array(channel) || channel.length !== channelLength) {
      throw new TypeError(
        `glTF instances instances.${field} must be a Float32Array of length ${channelLength}`,
      );
    }
  }
  for (const field of ['poseVersion', 'scaleVersion'] as const) {
    if (!Number.isSafeInteger(resource[field]) || !(resource[field]! >= 1)) {
      throw new TypeError(`glTF instances instances.${field} must be a positive safe integer`);
    }
  }
  for (const field of [
    'commitPosition', 'commitPose', 'commitRotation', 'commitScale', 'subscribe',
  ] as const) {
    if (typeof resource[field] !== 'function') {
      throw new TypeError(`glTF instances instances.${field} must be a function`);
    }
  }
  if (resource.logicalIds !== undefined && resource.logicalIds.length !== count) {
    throw new TypeError(`glTF instances instances.logicalIds must contain ${count} strings`);
  }
  return resource as GltfInstanceTransforms;
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
  const copy = logicalIds.map((logicalId, index) =>
    resolvePickingId(logicalId, `glTF instance logicalIds[${index}]`)!);
  const unique = new Set(copy);
  if (unique.size !== copy.length) throw new Error('glTF instance logicalIds must be unique');
  return Object.freeze(copy);
};

export const createGltfInstanceTransforms = (
  options: CreateGltfInstanceTransformsOptions,
): GltfInstanceTransforms => {
  objectWithAllowedFields(
    options,
    GLTF_INSTANCE_TRANSFORM_FIELDS,
    'glTF instance transforms',
  );
  const count = positiveCount(options.count);
  const listeners = new Map<object, GltfInstanceTransformsListener>();
  let poseVersion = 1;
  let scaleVersion = 1;
  const positions = copyChannel(options.positions, count, 0, 'positions');
  const rotations = copyChannel(options.rotations, count, 0, 'rotations');
  const scales = copyChannel(options.scales, count, 1, 'scales');
  const logicalIds = logicalIdsFrom(options.logicalIds, count);
  validateFiniteChannel(positions, 'positions');
  validateFiniteChannel(rotations, 'rotations');
  validateScales(scales);
  let notifying = false;
  const notify = (
    channel: GltfInstanceTransformChannel,
    start: number,
    rangeCount: number,
    version: number,
  ): void => {
    const cohort = [...listeners.values()];
    let failed = false;
    let firstFailure: unknown;
    notifying = true;
    try {
      for (const listener of cohort) {
        try {
          listener(channel, start, rangeCount, version);
        } catch (value) {
          if (!failed) {
            failed = true;
            firstFailure = value;
          }
        }
      }
    } finally {
      notifying = false;
    }
    if (failed) throw firstFailure;
  };
  const transforms: GltfInstanceTransforms = {
    count,
    ...(logicalIds === undefined ? {} : { logicalIds }),
    commitPosition: (startIndex, committedCount) => {
      if (notifying) throw new Error('glTF instance commit cannot run from an instance transform subscriber');
      assertCommittedRange(count, startIndex, committedCount);
      const start = startIndex ?? 0;
      const rangeCount = committedCount ?? count - start;
      validateFiniteChannel(positions, 'positions', start * 3, (start + rangeCount) * 3);
      poseVersion += 1;
      notify('position', start, rangeCount, poseVersion);
    },
    commitPose: (startIndex, committedCount) => {
      if (notifying) throw new Error('glTF instance commit cannot run from an instance transform subscriber');
      assertCommittedRange(count, startIndex, committedCount);
      const start = startIndex ?? 0;
      const rangeCount = committedCount ?? count - start;
      const startOffset = start * 3;
      const endOffset = (start + rangeCount) * 3;
      validateFiniteChannel(positions, 'positions', startOffset, endOffset);
      validateFiniteChannel(rotations, 'rotations', startOffset, endOffset);
      poseVersion += 1;
      notify('pose', start, rangeCount, poseVersion);
    },
    commitRotation: (startIndex, committedCount) => {
      if (notifying) throw new Error('glTF instance commit cannot run from an instance transform subscriber');
      assertCommittedRange(count, startIndex, committedCount);
      const start = startIndex ?? 0;
      const rangeCount = committedCount ?? count - start;
      validateFiniteChannel(rotations, 'rotations', start * 3, (start + rangeCount) * 3);
      poseVersion += 1;
      notify('rotation', start, rangeCount, poseVersion);
    },
    commitScale: (startIndex, committedCount) => {
      if (notifying) throw new Error('glTF instance commit cannot run from an instance transform subscriber');
      assertCommittedRange(count, startIndex, committedCount);
      const start = startIndex ?? 0;
      const rangeCount = committedCount ?? count - start;
      const startOffset = start * 3;
      const endOffset = (start + rangeCount) * 3;
      validateScales(scales, startOffset, endOffset);
      scaleVersion += 1;
      notify('scale', start, rangeCount, scaleVersion);
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
      if (typeof listener !== 'function') {
        throw new TypeError('glTF instance transform listener must be a function');
      }
      const token = {};
      listeners.set(token, listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(token);
      };
    },
  };
  return Object.freeze(transforms);
};

export interface GltfInstancesNode {
  readonly asset: GltfAssetRef;
  readonly instances: GltfInstanceTransforms;
  readonly kind: 'gltf-instances';
  /** Exact triangle proxy repeated in each instance's local space. */
  readonly pickingGeometry?: Geometry;
  readonly pickingId?: PickingId;
  /** Exact material-variant name. Unknown names fall back to the base material. */
  readonly materialVariant?: GltfMaterialVariantName;
}

export interface GltfInstancesOptions {
  readonly bounds?: GltfAssetBounds;
  readonly instances: GltfInstanceTransforms;
  /** Exact triangle proxy repeated in each instance's local space, available before asset load. */
  readonly pickingGeometry?: Geometry;
  readonly pickingId?: PickingId;
  readonly src: string;
  /** Exact `KHR_materials_variants` name selected from the asset. */
  readonly materialVariant?: GltfMaterialVariantName;
  readonly version?: GltfAssetRef['version'];
}

const GLTF_INSTANCES_FIELDS = [
  'bounds', 'instances', 'materialVariant', 'pickingGeometry', 'pickingId', 'src', 'version',
] as const;

export const gltfInstances = (options: GltfInstancesOptions): GltfInstancesNode => {
  objectWithAllowedFields(options, GLTF_INSTANCES_FIELDS, 'glTF instances');
  const instances = validateInstanceTransforms(options.instances);
  if (options.pickingGeometry !== undefined) {
    validateGeometry(options.pickingGeometry, 'glTF instances pickingGeometry');
  }
  const asset = resolveGltfAsset(options);
  const pickingId = resolvePickingId(options.pickingId, 'glTF instances pickingId');
  const materialVariant = validateGltfMaterialVariantName(options.materialVariant);
  return Object.freeze({
    asset,
    instances,
    kind: 'gltf-instances',
    ...(options.pickingGeometry === undefined ? {} : { pickingGeometry: options.pickingGeometry }),
    ...(pickingId === undefined ? {} : { pickingId }),
    ...(materialVariant === undefined ? {} : { materialVariant }),
  });
};
