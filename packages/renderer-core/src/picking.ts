import type { GltfNode } from './gltf';
import type { GltfInstancesNode } from './gltf-instances';
import type { MeshNode } from './mesh';
import type { Metres, WorldPosition3 } from './primitives';

export type PickingId = string;

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
  readonly primitiveKey?: string;
}

export interface GltfInstancesPickTarget {
  readonly id?: PickingId;
  /** Stable caller identity when supplied by the bulk instance source. */
  readonly instanceId?: PickingId;
  readonly instanceIndex: number;
  readonly kind: 'gltf-instances';
  readonly node: GltfInstancesNode;
  readonly primitiveKey?: string;
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
