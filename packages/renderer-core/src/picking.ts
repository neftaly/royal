import type { GltfNode } from './gltf';
import type { GltfInstancesNode } from './gltf-instances';
import type { MeshNode } from './mesh';
import type { Metres, WorldPosition3 } from './primitives';
import { nonEmptyString } from './descriptor-values';

/** Stable, non-empty application identity for one interactive scene target. */
export type PickingId = string;

/** @internal Normalizes every picking identity at its descriptor boundary. */
export const resolvePickingId = (
  value: PickingId | undefined,
  label: string,
): PickingId | undefined => value === undefined ? undefined : nonEmptyString(value, label);

export interface PickInput {
  /** CSS-pixel coordinate relative to the browser viewport. */
  readonly clientX: number;
  /** CSS-pixel coordinate relative to the browser viewport. */
  readonly clientY: number;
}

export interface MeshPickTarget {
  readonly id?: PickingId;
  readonly kind: 'mesh';
  readonly node: MeshNode;
}

export interface GltfPickTarget {
  readonly id?: PickingId;
  readonly kind: 'gltf';
  readonly node: GltfNode;
}

export interface GltfInstancesPickTarget {
  readonly id?: PickingId;
  /** Stable caller identity when supplied by the bulk instance source. */
  readonly instanceId?: PickingId;
  readonly instanceIndex: number;
  readonly kind: 'gltf-instances';
  readonly node: GltfInstancesNode;
}

export type PickTarget = MeshPickTarget | GltfPickTarget | GltfInstancesPickTarget;

export interface PickResult {
  /** CSS-pixel coordinate supplied to the pick. */
  readonly clientX: number;
  /** CSS-pixel coordinate supplied to the pick. */
  readonly clientY: number;
  /** Ray distance from the camera to the hit point, in metres. */
  readonly distance: Metres;
  /** Hit point in Royal world space, in metres. */
  readonly point: WorldPosition3;
  readonly target: PickTarget;
}
