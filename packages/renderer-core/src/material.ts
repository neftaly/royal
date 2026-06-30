import type { Rgba } from './primitives';
import { solidTexture, type TextureRef } from './texture';

export type MaterialBaseColorInput = TextureRef | Rgba;

/** Lit material with a base color texture reference. */
export interface StandardMaterial {
  readonly kind: 'standard';
  readonly baseColor: TextureRef;
}

/** Base color material that ignores lights. */
export interface UnlitMaterial {
  readonly kind: 'unlit';
  readonly baseColor: TextureRef;
}

/** Surface wireframe material. */
export interface WireframeMaterial {
  readonly kind: 'wireframe';
  readonly baseColor: TextureRef;
  readonly width: number;
}

export type Material = StandardMaterial | UnlitMaterial | WireframeMaterial;

export interface StandardMaterialOptions {
  readonly baseColor: MaterialBaseColorInput;
}

export type UnlitMaterialOptions = StandardMaterialOptions;

export interface WireframeMaterialOptions extends StandardMaterialOptions {
  /** @defaultValue `1.25` */
  readonly width?: number;
}

const isRgba = (baseColor: MaterialBaseColorInput): baseColor is Rgba =>
  Array.isArray(baseColor);

const toBaseColorTexture = (baseColor: MaterialBaseColorInput): TextureRef =>
  isRgba(baseColor) ? solidTexture({ color: baseColor }) : baseColor;

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  return {
    kind: 'standard',
    baseColor: toBaseColorTexture(options.baseColor)
  };
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  return {
    kind: 'unlit',
    baseColor: toBaseColorTexture(options.baseColor)
  };
};

export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  return {
    kind: 'wireframe',
    baseColor: toBaseColorTexture(options.baseColor),
    width: options.width ?? 1.25
  };
};
