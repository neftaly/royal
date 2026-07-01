import type { GltfNode } from './gltf';
import type { MeshNode } from './mesh';
import type { Vec3 } from './primitives';

export type PickingId = string;

export interface PickInput {
  readonly clientX: number;
  readonly clientY: number;
}

export interface PickTarget {
  readonly id?: PickingId;
  readonly kind: 'mesh' | 'gltf';
  readonly node: MeshNode | GltfNode;
  readonly primitiveKey?: string;
}

export interface PickResult {
  readonly clientX: number;
  readonly clientY: number;
  readonly distance: number;
  readonly point: Vec3;
  readonly target: PickTarget;
}
