import type { LinearRgba } from './primitives';
import { finiteNumber, objectWithAllowedFields } from './descriptor-values';
import { solidTexture, type TextureRef } from './texture';

export type MaterialSurfaceOptions =
  | {
    /** Scene-linear RGBA base color. Use `linearRgbaFromSrgb` for authored sRGB values. */
    readonly color: LinearRgba;
    readonly texture?: never;
  }
  | {
    readonly color?: never;
    /** Base-color texture using Royal's upper-left source orientation. */
    readonly texture: TextureRef;
  };

/** Normalized lit material descriptor. Create with `standardMaterial({ color })` or `standardMaterial({ texture })`. */
export interface StandardMaterial {
  readonly kind: 'standard';
  readonly baseColor: TextureRef;
  /** Metallic weight within 0..1. */
  readonly metallic: number;
  /** Perceptual roughness within 0..1. */
  readonly roughness: number;
}

/** Normalized unlit material descriptor. Create with `unlitMaterial({ color })` or `unlitMaterial({ texture })`. */
export interface UnlitMaterial {
  readonly kind: 'unlit';
  readonly baseColor: TextureRef;
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

export type UnlitMaterialOptions = MaterialSurfaceOptions;

export interface WireframeMaterialOptions {
  /** Scene-linear RGBA line color. Use `linearRgbaFromSrgb` for authored sRGB values. */
  readonly color: LinearRgba;
}

const toBaseColorTexture = (options: MaterialSurfaceOptions, label: string): TextureRef => {
  if ((options.color === undefined) === (options.texture === undefined)) {
    throw new TypeError(`${label} requires exactly one of color or texture`);
  }
  if (options.texture !== undefined) return options.texture;
  return solidTexture({ color: options.color });
};

const STANDARD_MATERIAL_FIELDS = ['color', 'metallic', 'roughness', 'texture'] as const;
const UNLIT_MATERIAL_FIELDS = ['color', 'texture'] as const;
const WIREFRAME_MATERIAL_FIELDS = ['color'] as const;

const factor01 = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must be within 0..1`);
  return value;
};

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  objectWithAllowedFields(options, STANDARD_MATERIAL_FIELDS, 'standard material');
  return {
    kind: 'standard',
    baseColor: toBaseColorTexture(options, 'standard material'),
    metallic: factor01(options.metallic, 0, 'standard material metallic'),
    roughness: factor01(options.roughness, 1, 'standard material roughness')
  };
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  objectWithAllowedFields(options, UNLIT_MATERIAL_FIELDS, 'unlit material');
  return {
    kind: 'unlit',
    baseColor: toBaseColorTexture(options, 'unlit material')
  };
};

export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  objectWithAllowedFields(options, WIREFRAME_MATERIAL_FIELDS, 'wireframe material');
  return {
    kind: 'wireframe',
    baseColor: solidTexture({ color: options.color })
  };
};
