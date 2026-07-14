import type { LinearRgba } from './primitives';
import { finiteNumber, positiveFiniteNumber } from './descriptor-values';
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
  readonly width: number;
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
  /** @defaultValue `1.25` */
  readonly width?: number;
}

const toBaseColorTexture = (options: MaterialSurfaceOptions): TextureRef => {
  if (options.texture !== undefined) return options.texture;
  return solidTexture({ color: options.color });
};

const factor01 = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be within 0..1`);
  return value;
};

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  return Object.freeze({
    kind: 'standard',
    baseColor: toBaseColorTexture(options),
    metallicFactor: factor01(options.metallic, 0, 'standard material metallic'),
    roughnessFactor: factor01(options.roughness, 1, 'standard material roughness')
  });
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  return Object.freeze({
    kind: 'unlit',
    baseColor: toBaseColorTexture(options)
  });
};

export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  return Object.freeze({
    kind: 'wireframe',
    baseColor: solidTexture({ color: options.color }),
    width: positiveFiniteNumber(options.width ?? 1.25, 'wireframe material width')
  });
};
