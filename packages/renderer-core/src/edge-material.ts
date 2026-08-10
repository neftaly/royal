import {
  finiteNumber,
  objectWithAllowedFields,
  resolveRgba,
  validateRgba,
} from './descriptor-values';
import type { LinearRgba } from './primitives';
import {
  resolveScreenSpacePartition,
  type ScreenSpacePartition,
  validateScreenSpacePartition,
} from './screen-space-partition';

/** Shared screen-space presentation style for glTF outlines and overlay segments. */
export interface EdgeMaterial {
  readonly kind: 'edge';
  /** Scene-linear RGBA edge color. */
  readonly color: LinearRgba;
  /** Optional complementary view-local screen-space coverage. */
  readonly coverage?: ScreenSpacePartition;
  /** Requested full outline or segment width in CSS pixels. */
  readonly widthCssPixels: number;
}

export interface EdgeMaterialOptions {
  /** Scene-linear RGBA edge color. Use `linearRgbaFromSrgb` for authored sRGB values. */
  readonly color: LinearRgba;
  /** Optional complementary view-local screen-space coverage. */
  readonly coverage?: ScreenSpacePartition;
  /** Full outline or segment width in CSS pixels, within `(0, 16]`. */
  readonly widthCssPixels: number;
}

const EDGE_MATERIAL_FIELDS = ['color', 'coverage', 'widthCssPixels'] as const;
const MAX_EDGE_WIDTH_CSS_PIXELS = 16;
const EDGE_MATERIAL_DESCRIPTOR_FIELDS = [
  'color', 'coverage', 'kind', 'widthCssPixels',
] as const;

/** @internal Validates a structurally supplied edge material at an outline boundary. */
export const validateEdgeMaterial: (
  value: unknown,
  label: string,
) => asserts value is EdgeMaterial = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an edge material descriptor`);
  }
  const material = value as Partial<EdgeMaterial>;
  if (material.kind !== 'edge') throw new TypeError(`${label} must be an edge material descriptor`);
  objectWithAllowedFields(value, EDGE_MATERIAL_DESCRIPTOR_FIELDS, label);
  validateRgba(material.color, `${label} color`);
  if (material.coverage !== undefined) {
    validateScreenSpacePartition(material.coverage, `${label} coverage`);
  }
  const widthCssPixels = finiteNumber(material.widthCssPixels as number, `${label} widthCssPixels`);
  if (!(widthCssPixels > 0) || widthCssPixels > MAX_EDGE_WIDTH_CSS_PIXELS) {
    throw new RangeError(
      `${label} widthCssPixels must be within (0, ${MAX_EDGE_WIDTH_CSS_PIXELS}]`,
    );
  }
};

/** Creates the shared presentation style for outlines and overlay segments. */
export const edgeMaterial = (options: EdgeMaterialOptions): EdgeMaterial => {
  objectWithAllowedFields(options, EDGE_MATERIAL_FIELDS, 'edge material');
  const widthCssPixels = finiteNumber(
    options.widthCssPixels,
    'edge material widthCssPixels',
  );
  if (!(widthCssPixels > 0) || widthCssPixels > MAX_EDGE_WIDTH_CSS_PIXELS) {
    throw new RangeError(
      `edge material widthCssPixels must be within (0, ${MAX_EDGE_WIDTH_CSS_PIXELS}]`,
    );
  }
  return {
    color: resolveRgba(options.color, 'edge material color'),
    ...(options.coverage === undefined
      ? {}
      : {
          coverage: resolveScreenSpacePartition(
            options.coverage,
            'edge material coverage',
          ),
        }),
    kind: 'edge',
    widthCssPixels,
  };
};
