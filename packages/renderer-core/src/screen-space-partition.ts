import {
  finiteNumber,
  objectWithAllowedFields,
  positiveFiniteNumber,
} from './descriptor-values';

/** Complementary, view-local screen-space coverage authored in CSS-pixel cells. */
export interface ScreenSpacePartition {
  readonly kind: 'screen-space-partition';
  /** Width and height of one square coverage cell in CSS pixels. */
  readonly cellSizeCssPixels: number;
  /** Number of complementary partitions sharing the same spatial phase, in `[1, 4096]`. */
  readonly count: number;
  /** Selected partition in `[0, count)`. */
  readonly index: number;
}

export interface ScreenSpacePartitionOptions {
  /** Width and height of one square coverage cell in CSS pixels. */
  readonly cellSizeCssPixels: number;
  /** Number of complementary partitions sharing the same spatial phase, in `[1, 4096]`. */
  readonly count: number;
  /** Selected partition in `[0, count)`. */
  readonly index: number;
}

const SCREEN_SPACE_PARTITION_OPTION_FIELDS = [
  'cellSizeCssPixels',
  'count',
  'index',
] as const;
const SCREEN_SPACE_PARTITION_FIELDS = [
  ...SCREEN_SPACE_PARTITION_OPTION_FIELDS,
  'kind',
] as const;
// Every valid index owns at least one cell in the shared 64-by-64 pattern.
const MAX_PARTITION_COUNT = 4096;

const validatePartitionValues = (
  options: ScreenSpacePartitionOptions,
  label: string,
): void => {
  positiveFiniteNumber(
    options.cellSizeCssPixels,
    `${label} cellSizeCssPixels`,
  );
  const count = finiteNumber(options.count, `${label} count`);
  if (!Number.isInteger(count) || count < 1 || count > MAX_PARTITION_COUNT) {
    throw new RangeError(
      `${label} count must be an integer within [1, ${MAX_PARTITION_COUNT}]`,
    );
  }
  const index = finiteNumber(options.index, `${label} index`);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${label} index must be an integer within [0, count)`);
  }
};

const resolvePartitionValues = (
  options: ScreenSpacePartitionOptions,
  label: string,
): ScreenSpacePartition => {
  validatePartitionValues(options, label);
  return {
    cellSizeCssPixels: options.cellSizeCssPixels,
    count: options.count,
    index: options.index,
    kind: 'screen-space-partition',
  };
};

/** @internal Validates composed coverage without allocating an ownership copy. */
export const validateScreenSpacePartition: (
  value: unknown,
  label: string,
) => asserts value is ScreenSpacePartition = (value, label) => {
  objectWithAllowedFields(value as ScreenSpacePartition, SCREEN_SPACE_PARTITION_FIELDS, label);
  const partition = value as Partial<ScreenSpacePartition>;
  if (partition.kind !== 'screen-space-partition') {
    throw new TypeError(`${label} kind must be screen-space-partition`);
  }
  validatePartitionValues(partition as ScreenSpacePartition, label);
};

/** Validates and copies a nested public coverage descriptor. */
export const resolveScreenSpacePartition = (
  value: ScreenSpacePartition,
  label: string,
): ScreenSpacePartition => {
  validateScreenSpacePartition(value, label);
  return {
    cellSizeCssPixels: value.cellSizeCssPixels,
    count: value.count,
    index: value.index,
    kind: 'screen-space-partition',
  };
};

/** Creates one member of an exact complementary screen-space partition. */
export const screenSpacePartition = (
  options: ScreenSpacePartitionOptions,
): ScreenSpacePartition => {
  objectWithAllowedFields(
    options,
    SCREEN_SPACE_PARTITION_OPTION_FIELDS,
    'screen-space partition',
  );
  return resolvePartitionValues(options, 'screen-space partition');
};
