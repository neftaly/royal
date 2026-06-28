import type { Direction3, Rgba } from './primitives';

/** Directional light in world space. */
export interface DirectionalLightNode {
  readonly kind: 'directional-light';
  readonly direction: Direction3;
  readonly color: Rgba;
}

export interface DirectionalLightOptions {
  /** World-space light direction. */
  readonly direction: Direction3;
  readonly color: Rgba;
}

export const directionalLight = (options: DirectionalLightOptions): DirectionalLightNode => ({
  kind: 'directional-light',
  direction: options.direction,
  color: options.color
});
