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

/** Surface wireframe material. */
export interface WireframeMaterial {
  readonly kind: 'wireframe';
  readonly baseColor: TextureRef;
  readonly width: number;
}

export type Material = StandardMaterial | UnlitMaterial | WireframeMaterial;

export interface StandardMaterialOptions {
  readonly baseColor: TextureRef;
}

export type UnlitMaterialOptions = StandardMaterialOptions;

export interface WireframeMaterialOptions extends StandardMaterialOptions {
  /** @defaultValue `1.25` */
  readonly width?: number;
}

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

export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  return {
    kind: 'wireframe',
    baseColor: options.baseColor,
    width: options.width ?? 1.25
  };
};
