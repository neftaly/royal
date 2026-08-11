import { objectWithAllowedFields, resolveVec3 } from './descriptor-values';
import { validateEdgeMaterial, type EdgeMaterial } from './edge-material';
import type { WorldPosition3 } from './primitives';

/** One world-anchored overlay segment with presentation-space width. */
export interface ScreenSpaceSegmentNode {
  readonly kind: 'screen-space-segment';
  readonly start: WorldPosition3;
  readonly end: WorldPosition3;
  readonly material: EdgeMaterial;
}

export interface ScreenSpaceSegmentOptions {
  /** Segment endpoint in world metres. */
  readonly start: WorldPosition3;
  /** Distinct segment endpoint in world metres. */
  readonly end: WorldPosition3;
  /** Scene-linear color, presentation-space width, and optional complementary coverage. */
  readonly material: EdgeMaterial;
}

const SCREEN_SPACE_SEGMENT_FIELDS = ['end', 'material', 'start'] as const;
const SCREEN_SPACE_SEGMENT_DESCRIPTOR_FIELDS = ['end', 'kind', 'material', 'start'] as const;

const resolveEndpoints = (
  startInput: unknown,
  endInput: unknown,
): readonly [start: WorldPosition3, end: WorldPosition3] => {
  const start = resolveVec3(startInput, 'screen-space segment start') as WorldPosition3;
  const end = resolveVec3(endInput, 'screen-space segment end') as WorldPosition3;
  for (let axis = 0; axis < 3; axis += 1) {
    if (!Number.isFinite(Math.fround(start[axis]!))) {
      throw new RangeError(`screen-space segment start[${axis}] cannot be represented as a finite float`);
    }
    if (!Number.isFinite(Math.fround(end[axis]!))) {
      throw new RangeError(`screen-space segment end[${axis}] cannot be represented as a finite float`);
    }
  }
  if (
    Math.fround(start[0]) === Math.fround(end[0])
    && Math.fround(start[1]) === Math.fround(end[1])
    && Math.fround(start[2]) === Math.fround(end[2])
  ) throw new RangeError('screen-space segment endpoints must be distinct');
  return [start, end];
};

/** @internal Validates a structurally supplied segment at an overlay boundary. */
export const validateScreenSpaceSegment: (
  value: unknown,
  label: string,
) => asserts value is ScreenSpaceSegmentNode = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a screen-space segment descriptor`);
  }
  const node = value as Partial<ScreenSpaceSegmentNode>;
  if (node.kind !== 'screen-space-segment') {
    throw new TypeError(`${label} must be a screen-space segment descriptor`);
  }
  objectWithAllowedFields(value, SCREEN_SPACE_SEGMENT_DESCRIPTOR_FIELDS, label);
  resolveEndpoints(node.start, node.end);
  validateEdgeMaterial(node.material, `${label} material`);
};

/** Creates one non-picking segment accepted only by a scene overlay. */
export const screenSpaceSegment = (
  options: ScreenSpaceSegmentOptions,
): ScreenSpaceSegmentNode => {
  objectWithAllowedFields(options, SCREEN_SPACE_SEGMENT_FIELDS, 'screen-space segment');
  const [start, end] = resolveEndpoints(options.start, options.end);
  validateEdgeMaterial(options.material, 'screen-space segment material');
  return { end, kind: 'screen-space-segment', material: options.material, start };
};
