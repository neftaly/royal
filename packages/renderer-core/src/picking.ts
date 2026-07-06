import type { GltfNode } from './gltf';
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

export type PickTarget = MeshPickTarget | GltfPickTarget;

export interface PickResult {
  readonly clientX: number;
  readonly clientY: number;
  readonly distance: number;
  readonly point: Vec3;
  readonly target: PickTarget;
}
