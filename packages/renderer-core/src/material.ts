import type { Rgba } from './primitives';
import { solidTexture, type TextureRef } from './texture';

export type MaterialColorInput = Rgba;
export type MaterialTextureInput = TextureRef;

export type MaterialSurfaceOptions =
  | {
    readonly color: MaterialColorInput;
    readonly texture?: never;
  }
  | {
    readonly color?: never;
    readonly texture: MaterialTextureInput;
  };

/** Normalized lit material descriptor. Create with `standardMaterial({ color })` or `standardMaterial({ texture })`. */
export interface StandardMaterial {
  readonly kind: 'standard';
  readonly baseColor: TextureRef;
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

export type StandardMaterialOptions = MaterialSurfaceOptions;

export type UnlitMaterialOptions = StandardMaterialOptions;

export interface WireframeMaterialOptions {
  readonly color: MaterialColorInput;
  /** @defaultValue `1.25` */
  readonly width?: number;
}

const toBaseColorTexture = (options: MaterialSurfaceOptions): TextureRef => {
  if (options.texture !== undefined) return options.texture;
  return solidTexture({ color: options.color });
};

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  return {
    kind: 'standard',
    baseColor: toBaseColorTexture(options)
  };
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  return {
    kind: 'unlit',
    baseColor: toBaseColorTexture(options)
  };
};

export const wireframeMaterial = (options: WireframeMaterialOptions): WireframeMaterial => {
  return {
    kind: 'wireframe',
    baseColor: solidTexture({ color: options.color }),
    width: options.width ?? 1.25
  };
};
