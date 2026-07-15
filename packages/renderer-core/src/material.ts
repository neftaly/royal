import type { LinearRgba } from './primitives';
import { finiteNumber } from './descriptor-values';
import { solidTexture, type TextureRef } from './texture';

export type MaterialSurfaceOptions =
  | {
    readonly color: LinearRgba;
    readonly texture?: never;
  }
  | {
    readonly color?: never;
    readonly texture: TextureRef;
  };

/** Normalized lit material descriptor. Create with `standardMaterial({ color })` or `standardMaterial({ texture })`. */
export interface StandardMaterial {
  readonly kind: 'standard';
  readonly baseColor: TextureRef;
  readonly metallicFactor: number;
  readonly roughnessFactor: number;
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
  readonly color: LinearRgba;
}

const validatedMaterialOptions = <Options extends object>(
  options: Options,
  allowedFields: ReadonlySet<string>,
  label: string,
): Options => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
  for (const field of Object.keys(options)) {
    if (!allowedFields.has(field)) {
      throw new TypeError(`${label} options contain unsupported option ${JSON.stringify(field)}`);
    }
  }
  return options;
};

const toBaseColorTexture = (options: MaterialSurfaceOptions, label: string): TextureRef => {
  if ((options.color === undefined) === (options.texture === undefined)) {
    throw new TypeError(`${label} requires exactly one of color or texture`);
  }
  if (options.texture !== undefined) return options.texture;
  return solidTexture({ color: options.color });
};

const STANDARD_MATERIAL_FIELDS = new Set(['color', 'metallic', 'roughness', 'texture']);
const UNLIT_MATERIAL_FIELDS = new Set(['color', 'texture']);
const WIREFRAME_MATERIAL_FIELDS = new Set(['color']);

const factor01 = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be within 0..1`);
  return value;
};

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  validatedMaterialOptions(options, STANDARD_MATERIAL_FIELDS, 'standard material');
  return Object.freeze({
    kind: 'standard',
    baseColor: toBaseColorTexture(options, 'standard material'),
    metallicFactor: factor01(options.metallic, 0, 'standard material metallic'),
    roughnessFactor: factor01(options.roughness, 1, 'standard material roughness')
  });
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  validatedMaterialOptions(options, UNLIT_MATERIAL_FIELDS, 'unlit material');
  return Object.freeze({
    kind: 'unlit',
    baseColor: toBaseColorTexture(options, 'unlit material')
  });
};

export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  validatedMaterialOptions(options, WIREFRAME_MATERIAL_FIELDS, 'wireframe material');
  return Object.freeze({
    kind: 'wireframe',
    baseColor: solidTexture({ color: options.color })
  });
};
