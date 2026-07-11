import type { GltfNode } from './gltf';
import type { GltfInstancesNode } from './gltf-instances';
import type { MeshNode } from './mesh';
import type { Vec3 } from './primitives';

export type PickingId = string;

export interface PickInput {
  readonly clientX: number;
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
  readonly clientX: number;
  readonly clientY: number;
  readonly distance: number;
  readonly point: Vec3;
  readonly target: PickTarget;
}
