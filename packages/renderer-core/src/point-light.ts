import { frozenRgba, frozenVec3 } from './descriptor-values';
import type { Metres, Rgba, WorldPosition3 } from './primitives';

export interface PointLightNode {
  readonly kind: 'point-light';
  readonly color: Rgba;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

export interface PointLightOptions {
  readonly color?: Rgba;
  /** Luminous intensity in candela. */
  readonly intensityCandela: number;
  /** World-space position in metres. */
  readonly position: WorldPosition3;
  /** Optional maximum influence distance in metres. */
  readonly range?: Metres;
}

const WHITE: Rgba = frozenRgba([1, 1, 1, 1], 'point light color');
const finitePositive = (value: number | undefined, label: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
  return value;
};

export const pointLight = (options: PointLightOptions): PointLightNode => {
  const range = finitePositive(options.range, 'point light range');
  return Object.freeze({
    kind: 'point-light',
    color: options.color === undefined ? WHITE : frozenRgba(options.color, 'point light color'),
    intensityCandela: finitePositive(options.intensityCandela, 'point light intensityCandela')!,
    position: frozenVec3(options.position, 'point light position'),
    ...(range === undefined ? {} : { range })
  });
};
