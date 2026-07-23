import {
  resolveGltfAsset,
  validateGltfMaterialVariantName,
  type GltfAssetBounds,
  type GltfAssetRef,
  type GltfMaterialVariantName,
} from './gltf';
import { resolvePickingId, type PickingId } from './picking';
import { validateGeometry, type Geometry } from './geometry';
import { objectWithAllowedFields, resolveRgba } from './descriptor-values';
import type { LinearRgba } from './primitives';

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
  /** Packed finite signed dimensionless XYZ multipliers (`count * 3`). */
  readonly scales: Float32Array;
  /** Notify attached renderer roots after mutating positions only. */
  commitPosition(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating positions or rotations. */
  commitPose(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating rotations only. */
  commitRotation(startIndex?: number, count?: number): void;
  /** Notify attached renderer roots after mutating finite signed scales. */
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

type GltfInstanceTransformsListenerSlot = {
  active: boolean;
  readonly listener: GltfInstanceTransformsListener;
};

export interface CreateGltfInstanceTransformsOptions {
  /** Positive number of stable logical instances represented by every channel. */
  readonly count: number;
  /** Optional stable application identity for each logical index (`count` entries). */
  readonly logicalIds?: readonly PickingId[];
  /** Packed XYZ translations in metres (`count * 3`). @defaultValue all zero */
  readonly positions?: ArrayLike<number>;
  /** Packed XYZ Euler angles in radians (`count * 3`). @defaultValue all zero */
  readonly rotations?: ArrayLike<number>;
  /** Packed finite signed dimensionless XYZ multipliers (`count * 3`). @defaultValue all one */
  readonly scales?: ArrayLike<number>;
}

const GLTF_INSTANCE_TRANSFORM_FIELDS = [
  'count', 'logicalIds', 'positions', 'rotations', 'scales',
] as const;

const positiveCount = (count: number): number => {
  if (typeof count !== 'number') {
    throw new TypeError(`glTF instance transform count must be a number; received ${String(count)}`);
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`glTF instance transform count must be a positive safe integer; received ${String(count)}`);
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
    if (typeof resource[field] !== 'number') {
      throw new TypeError(`glTF instances instances.${field} must be a positive safe integer`);
    }
    if (!Number.isSafeInteger(resource[field]) || !(resource[field]! >= 1)) {
      throw new RangeError(`glTF instances instances.${field} must be a positive safe integer`);
    }
  }
  for (const field of [
    'commitPosition', 'commitPose', 'commitRotation', 'commitScale', 'subscribe',
  ] as const) {
    if (typeof resource[field] !== 'function') {
      throw new TypeError(`glTF instances instances.${field} must be a function`);
    }
  }
  if (resource.logicalIds !== undefined) {
    if (!Array.isArray(resource.logicalIds) || resource.logicalIds.length !== count) {
      throw new TypeError(`glTF instances instances.logicalIds must contain ${count} strings`);
    }
    const uniqueLogicalIds = new Set<string>();
    resource.logicalIds.forEach((logicalId, index) => {
      uniqueLogicalIds.add(resolvePickingId(
        logicalId,
        `glTF instances instances.logicalIds[${index}]`,
      )!);
    });
    if (uniqueLogicalIds.size !== count) {
      throw new RangeError('glTF instances instances.logicalIds must be unique');
    }
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
  const channel = new Float32Array(length);
  if (source === undefined) {
    if (fallback !== 0) channel.fill(fallback);
  } else {
    if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
      throw new TypeError(`glTF instance ${label} must be an array-like object`);
    }
    if (source.length !== length) {
      throw new TypeError(
        `glTF instance ${label} must contain ${length} numbers; received ${String(source.length)}`,
      );
    }
    for (let index = 0; index < length; index += 1) {
      const value = source[index];
      if (typeof value !== 'number') {
        throw new TypeError(
          `glTF instance ${label}[${index}] must be a number; received ${String(value)}`,
        );
      }
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `glTF instance ${label}[${index}] must be finite; received ${String(value)}`,
        );
      }
      channel[index] = value;
      if (!Number.isFinite(channel[index])) {
        throw new RangeError(
          `glTF instance ${label}[${index}] cannot be represented as a finite float`,
        );
      }
    }
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
  if (typeof start !== 'number' || typeof committedCount !== 'number') {
    throw new TypeError('glTF instance commit startIndex and count must be numbers');
  }
  if (
    !Number.isInteger(start)
    || !Number.isInteger(committedCount)
    || start < 0
    || committedCount < 1
    || start + committedCount > total
  ) {
    throw new RangeError(
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
      throw new TypeError(`glTF instance ${label} must be finite; received ${String(values[index])}`);
    }
  }
};

const logicalIdsFrom = (
  logicalIds: readonly PickingId[] | undefined,
  count: number,
): readonly PickingId[] | undefined => {
  if (logicalIds === undefined) return undefined;
  if (!Array.isArray(logicalIds)) {
    throw new TypeError('glTF instance logicalIds must be an array of strings');
  }
  if (logicalIds.length !== count) {
    throw new TypeError(`glTF instance logicalIds must contain ${count} strings; received ${logicalIds.length}`);
  }
  const copy = logicalIds.map((logicalId, index) =>
    resolvePickingId(logicalId, `glTF instance logicalIds[${index}]`)!);
  const unique = new Set(copy);
  if (unique.size !== copy.length) throw new RangeError('glTF instance logicalIds must be unique');
  return copy;
};

/** Creates a stable packed transform channel for frequently updated glTF instances. */
export const createGltfInstanceTransforms = (
  options: CreateGltfInstanceTransformsOptions,
): GltfInstanceTransforms => {
  objectWithAllowedFields(
    options,
    GLTF_INSTANCE_TRANSFORM_FIELDS,
    'glTF instance transforms',
  );
  const count = positiveCount(options.count);
  const listeners: GltfInstanceTransformsListenerSlot[] = [];
  const notificationCohort: GltfInstanceTransformsListenerSlot[] = [];
  let listenerTombstones = 0;
  let poseVersion = 1;
  let scaleVersion = 1;
  const positions = copyChannel(options.positions, count, 0, 'positions');
  const rotations = copyChannel(options.rotations, count, 0, 'rotations');
  const scales = copyChannel(options.scales, count, 1, 'scales');
  const logicalIds = logicalIdsFrom(options.logicalIds, count);
  let notifying = false;
  const notify = (
    channel: GltfInstanceTransformChannel,
    start: number,
    rangeCount: number,
    version: number,
  ): void => {
    for (const slot of listeners) {
      if (slot.active) notificationCohort.push(slot);
    }
    let failed = false;
    let firstFailure: unknown;
    notifying = true;
    try {
      for (const slot of notificationCohort) {
        try {
          slot.listener(channel, start, rangeCount, version);
        } catch (value) {
          if (!failed) {
            failed = true;
            firstFailure = value;
          }
        }
      }
    } finally {
      notifying = false;
      notificationCohort.length = 0;
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
      validateFiniteChannel(scales, 'scales', startOffset, endOffset);
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
      if (listenerTombstones > 16 && listenerTombstones * 2 > listeners.length) {
        let write = 0;
        for (const slot of listeners) {
          if (!slot.active) continue;
          listeners[write] = slot;
          write += 1;
        }
        listeners.length = write;
        listenerTombstones = 0;
      }
      const slot: GltfInstanceTransformsListenerSlot = {
        active: true,
        listener,
      };
      listeners.push(slot);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        slot.active = false;
        listenerTombstones += 1;
      };
    },
  };
  return transforms;
};

export interface GltfInstancesNode {
  readonly asset: GltfAssetRef;
  readonly instances: GltfInstanceTransforms;
  readonly kind: 'gltf-instances';
  /** Exact triangle proxy repeated in each instance's local space. */
  readonly pickingGeometry?: Geometry;
  /** Stable application identity shared by the instance collection. */
  readonly pickingId?: PickingId;
  /** Exact material-variant name. Unknown names fall back to the base material. */
  readonly materialVariant?: GltfMaterialVariantName;
  /** Scene-linear RGBA multiplier applied to every selected base color. */
  readonly tint?: LinearRgba;
}

export interface GltfInstancesOptions {
  /**
   * Optional coarse asset-space bounds available before source preparation.
   * They are not contact, collision, or support geometry.
   */
  readonly bounds?: GltfAssetBounds;
  /** Versioned bulk-transform source retained by renderer roots. */
  readonly instances: GltfInstanceTransforms;
  /** Exact triangle proxy repeated in each instance's local space, available before asset load. */
  readonly pickingGeometry?: Geometry;
  /** Stable application identity returned with every picked instance. */
  readonly pickingId?: PickingId;
  /** Zero-based glTF document scene to prepare; omit for the document default. */
  readonly sceneIndex?: number;
  /** URI of the glTF asset repeated by the bulk-transform source. */
  readonly src: string;
  /** Exact `KHR_materials_variants` name selected from the asset. */
  readonly materialVariant?: GltfMaterialVariantName;
  /** Scene-linear RGBA multiplier applied to every selected base color. */
  readonly tint?: LinearRgba;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
  readonly version?: GltfAssetRef['version'];
}

const GLTF_INSTANCES_FIELDS = [
  'bounds', 'instances', 'materialVariant', 'pickingGeometry', 'pickingId', 'sceneIndex', 'src', 'tint', 'version',
] as const;

/** Creates one instanced glTF node using the canonical glTF material and picking path. */
export const gltfInstances = (options: GltfInstancesOptions): GltfInstancesNode => {
  objectWithAllowedFields(options, GLTF_INSTANCES_FIELDS, 'glTF instances');
  const instances = validateInstanceTransforms(options.instances);
  if (options.pickingGeometry !== undefined) {
    validateGeometry(options.pickingGeometry, 'glTF instances pickingGeometry');
  }
  const asset = resolveGltfAsset(options);
  const pickingId = resolvePickingId(options.pickingId, 'glTF instances pickingId');
  const materialVariant = validateGltfMaterialVariantName(options.materialVariant);
  const tint = options.tint === undefined
    ? undefined
    : resolveRgba(options.tint, 'glTF instances tint');
  return {
    asset,
    instances,
    kind: 'gltf-instances',
    ...(options.pickingGeometry === undefined ? {} : { pickingGeometry: options.pickingGeometry }),
    ...(pickingId === undefined ? {} : { pickingId }),
    ...(materialVariant === undefined ? {} : { materialVariant }),
    ...(tint === undefined ? {} : { tint }),
  };
};
