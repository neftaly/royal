import { RenderNodeKind } from './kind';
import type { Direction3, Rgba } from './primitives';

/** Directional light in world space. */
export interface DirectionalLightNode {
  readonly kind: RenderNodeKind.DirectionalLight;
  readonly direction: Direction3;
  readonly color: Rgba;
}

export interface DirectionalLightOptions {
  /** World-space light direction. */
  readonly direction: Direction3;
  readonly color: Rgba;
}

export const directionalLight = (options: DirectionalLightOptions): DirectionalLightNode => ({
  kind: RenderNodeKind.DirectionalLight,
  direction: options.direction,
  color: options.color
});
