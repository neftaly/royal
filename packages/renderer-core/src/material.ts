import type { TextureRef } from './texture';

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

export type Material = StandardMaterial | UnlitMaterial;

export interface StandardMaterialOptions {
  readonly baseColor: TextureRef;
}

export type UnlitMaterialOptions = StandardMaterialOptions;

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  return {
    kind: 'standard',
    baseColor: options.baseColor
  };
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  return {
    kind: 'unlit',
    baseColor: options.baseColor
  };
};
