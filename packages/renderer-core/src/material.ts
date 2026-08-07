import type { LinearRgba } from './primitives';
import {
  finiteNumber,
  objectWithAllowedFields,
  resolveRgba,
  validateRgba,
} from './descriptor-values';
import {
  resolveScreenSpacePartition,
  type ScreenSpacePartition,
  validateScreenSpacePartition,
} from './screen-space-partition';
import { solidTexture, validateTextureRef, type TextureRef } from './texture';

export type MaterialSurfaceOptions =
  | {
    /** Scene-linear RGBA base color; alpha below 1 selects ordered blending. */
    readonly color: LinearRgba;
    readonly tint?: never;
    readonly texture?: never;
  }
  | {
    readonly color?: never;
    /** Base-color texture using Royal's upper-left source orientation. */
    readonly texture: TextureRef;
    /** Scene-linear RGBA multiplier; alpha below 1 selects ordered blending. @defaultValue `[1, 1, 1, 1]` */
    readonly tint?: LinearRgba;
  };

/** Normalized lit material descriptor. Create with `standardMaterial({ color })` or `standardMaterial({ texture })`. */
export interface StandardMaterial {
  readonly kind: 'standard';
  readonly baseColor: TextureRef;
  /** Scene-linear RGBA multiplier for a textured base color; alpha below 1 selects blending. */
  readonly tint?: LinearRgba;
  /** Metallic weight within 0..1. */
  readonly metallic: number;
  /** Perceptual roughness within 0..1. */
  readonly roughness: number;
}

/** Normalized unlit material descriptor. Create with `unlitMaterial({ color })` or `unlitMaterial({ texture })`. */
export interface UnlitMaterial {
  readonly kind: 'unlit';
  readonly baseColor: TextureRef;
  /** Optional complementary view-local screen-space fragment coverage. */
  readonly coverage?: ScreenSpacePartition;
  /** Scene-linear RGBA multiplier for a textured base color; alpha below 1 selects blending. */
  readonly tint?: LinearRgba;
}

/** Surface wireframe material. Authoring accepts a solid line color only. */
export interface WireframeMaterial {
  readonly kind: 'wireframe';
  readonly baseColor: TextureRef;
}

export type Material = StandardMaterial | UnlitMaterial | WireframeMaterial;

export type StandardMaterialOptions = MaterialSurfaceOptions & {
  /** @defaultValue `0` */
  readonly metallic?: number;
  /** @defaultValue `1` */
  readonly roughness?: number;
};

export type UnlitMaterialOptions = MaterialSurfaceOptions & {
  /** Optional complementary view-local screen-space fragment coverage. */
  readonly coverage?: ScreenSpacePartition;
};

export interface WireframeMaterialOptions {
  /** Scene-linear RGBA line color. Use `linearRgbaFromSrgb` for authored sRGB values. */
  readonly color: LinearRgba;
}

const toBaseColorTexture = (options: MaterialSurfaceOptions, label: string): TextureRef => {
  if ((options.color === undefined) === (options.texture === undefined)) {
    throw new TypeError(`${label} requires exactly one of color or texture`);
  }
  if (options.texture !== undefined) {
    validateTextureRef(options.texture, `${label} texture`);
    return options.texture;
  }
  return solidTexture({ color: options.color });
};

const materialTint = (
  options: MaterialSurfaceOptions,
  label: string,
): LinearRgba | undefined => {
  if (options.tint === undefined) return undefined;
  if (options.texture === undefined) throw new TypeError(`${label} tint requires texture`);
  return resolveRgba(options.tint, `${label} tint`);
};

const STANDARD_MATERIAL_FIELDS = ['color', 'metallic', 'roughness', 'texture', 'tint'] as const;
const UNLIT_MATERIAL_FIELDS = ['color', 'coverage', 'texture', 'tint'] as const;
const WIREFRAME_MATERIAL_FIELDS = ['color'] as const;
const STANDARD_MATERIAL_DESCRIPTOR_FIELDS = [
  'baseColor', 'kind', 'metallic', 'roughness', 'tint',
] as const;
const UNLIT_MATERIAL_DESCRIPTOR_FIELDS = ['baseColor', 'coverage', 'kind', 'tint'] as const;
const WIREFRAME_MATERIAL_DESCRIPTOR_FIELDS = ['baseColor', 'kind'] as const;

const factor01 = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be within 0..1`);
  return value;
};

/** @internal Validates a structurally supplied material at a mesh boundary. */
export const validateMaterial: (
  value: unknown,
  label: string,
) => asserts value is Material = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a Royal material descriptor`);
  }
  const material = value as Partial<Material>;
  if (material.kind === 'standard') {
    objectWithAllowedFields(value, STANDARD_MATERIAL_DESCRIPTOR_FIELDS, label);
    validateTextureRef(material.baseColor, `${label} baseColor`);
    if (material.tint !== undefined) validateRgba(material.tint, `${label} tint`);
    if (material.metallic === undefined || material.roughness === undefined) {
      throw new TypeError(`${label} must contain normalized metallic and roughness values`);
    }
    factor01(material.metallic, 0, `${label} metallic`);
    factor01(material.roughness, 1, `${label} roughness`);
    return;
  }
  if (material.kind === 'unlit') {
    objectWithAllowedFields(value, UNLIT_MATERIAL_DESCRIPTOR_FIELDS, label);
    validateTextureRef(material.baseColor, `${label} baseColor`);
    if (material.coverage !== undefined) {
      validateScreenSpacePartition(material.coverage, `${label} coverage`);
    }
    if (material.tint !== undefined) validateRgba(material.tint, `${label} tint`);
    return;
  }
  if (material.kind === 'wireframe') {
    objectWithAllowedFields(value, WIREFRAME_MATERIAL_DESCRIPTOR_FIELDS, label);
    validateTextureRef(material.baseColor, `${label} baseColor`);
    if (material.baseColor.kind !== 'solid') {
      throw new TypeError(`${label} baseColor must be a solidTexture descriptor`);
    }
    return;
  }
  throw new TypeError(`${label} must be a standardMaterial, unlitMaterial, or wireframeMaterial descriptor`);
};

/** Creates a metallic-roughness material from exactly one solid color or texture. */
export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  objectWithAllowedFields(options, STANDARD_MATERIAL_FIELDS, 'standard material');
  const tint = materialTint(options, 'standard material');
  return {
    kind: 'standard',
    baseColor: toBaseColorTexture(options, 'standard material'),
    ...(tint === undefined ? {} : { tint }),
    metallic: factor01(options.metallic, 0, 'standard material metallic'),
    roughness: factor01(options.roughness, 1, 'standard material roughness')
  };
};

/** Creates an unlit material from exactly one solid color or texture. */
export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  objectWithAllowedFields(options, UNLIT_MATERIAL_FIELDS, 'unlit material');
  const tint = materialTint(options, 'unlit material');
  return {
    kind: 'unlit',
    baseColor: toBaseColorTexture(options, 'unlit material'),
    ...(options.coverage === undefined
      ? {}
      : {
          coverage: resolveScreenSpacePartition(
            options.coverage,
            'unlit material coverage',
          ),
        }),
    ...(tint === undefined ? {} : { tint }),
  };
};

/** Creates a solid-color wireframe material. */
export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  objectWithAllowedFields(options, WIREFRAME_MATERIAL_FIELDS, 'wireframe material');
  return {
    kind: 'wireframe',
    baseColor: solidTexture({ color: options.color })
  };
};
