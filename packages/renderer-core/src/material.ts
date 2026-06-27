import { MaterialKind } from './kind';
import type { Rgba } from './primitives';

/** Flat RGBA material. */
export interface StandardMaterial {
  readonly kind: MaterialKind.Standard;
  readonly color: Rgba;
}

/** Flat RGBA material that ignores lights. */
export interface UnlitMaterial {
  readonly kind: MaterialKind.Unlit;
  readonly color: Rgba;
}

export type Material = StandardMaterial | UnlitMaterial;

export interface StandardMaterialOptions {
  readonly color: Rgba;
}

export type UnlitMaterialOptions = StandardMaterialOptions;

export const standardMaterial = (options: StandardMaterialOptions): StandardMaterial => ({
  kind: MaterialKind.Standard,
  color: options.color
});

export const unlitMaterial = (options: UnlitMaterialOptions): UnlitMaterial => ({
  kind: MaterialKind.Unlit,
  color: options.color
});
