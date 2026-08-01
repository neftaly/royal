import {
  finiteNumber,
  objectWithAllowedFields,
  resolveRgba,
} from './descriptor-values';
import type { LinearRgba } from './primitives';
import {
  resolveScreenSpacePartition,
  type ScreenSpacePartition,
} from './screen-space-partition';

/** Screen-space boundary and crease presentation used only by glTF outlines. */
export interface EdgeMaterial {
  readonly kind: 'edge';
  /** Scene-linear RGBA edge color. */
  readonly color: LinearRgba;
  /** Optional complementary view-local screen-space coverage. */
  readonly coverage?: ScreenSpacePartition;
  /** Requested full edge width in CSS pixels. */
  readonly widthCssPixels: number;
}

export interface EdgeMaterialOptions {
  /** Scene-linear RGBA edge color. Use `linearRgbaFromSrgb` for authored sRGB values. */
  readonly color: LinearRgba;
  /** Optional complementary view-local screen-space coverage. */
  readonly coverage?: ScreenSpacePartition;
  /** Full edge width in CSS pixels, within `(0, 16]`. */
  readonly widthCssPixels: number;
}

const EDGE_MATERIAL_FIELDS = ['color', 'coverage', 'widthCssPixels'] as const;
const MAX_EDGE_WIDTH_CSS_PIXELS = 16;

/** Creates a presentation-quality screen-space edge material. */
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
