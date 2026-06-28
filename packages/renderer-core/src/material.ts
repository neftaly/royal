import { MaterialKind } from './kind';
import type { Rgba } from './primitives';
import type { Texture2dResource } from './texture';

/** Flat RGBA material. */
export interface StandardMaterial {
  readonly baseColorTexture?: Texture2dResource;
  readonly kind: MaterialKind.Standard;
  readonly color: Rgba;
}

/** Flat RGBA material that ignores lights. */
export interface UnlitMaterial {
  readonly baseColorTexture?: Texture2dResource;
  readonly kind: MaterialKind.Unlit;
  readonly color: Rgba;
}

export type Material = StandardMaterial | UnlitMaterial;

export interface StandardMaterialOptions {
  readonly baseColorTexture?: Texture2dResource;
  readonly color: Rgba;
}

export type UnlitMaterialOptions = StandardMaterialOptions;

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => {
  const material: StandardMaterial = {
    kind: MaterialKind.Standard,
    color: options.color
  };
  return options.baseColorTexture === undefined
    ? material
    : { ...material, baseColorTexture: options.baseColorTexture };
};

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => {
  const material: UnlitMaterial = {
    kind: MaterialKind.Unlit,
    color: options.color
  };
  return options.baseColorTexture === undefined
    ? material
    : { ...material, baseColorTexture: options.baseColorTexture };
};
