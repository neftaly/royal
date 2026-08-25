import type { GltfNode } from './gltf';
import type { GltfInstancesNode } from './gltf-instances';
import type { MeshNode } from './mesh';
import type { Direction3, Metres, WorldPosition3 } from './primitives';
import { nonEmptyString } from './descriptor-values';

/** Stable, non-empty application identity for one interactive scene target. */
export type PickingId = string;

/** @internal Normalizes every picking identity at its descriptor boundary. */
export const resolvePickingId = (
  value: PickingId | undefined,
  label: string,
): PickingId | undefined => value === undefined ? undefined : nonEmptyString(value, label);

export interface PickInput {
  /** CSS-pixel coordinate relative to the browser viewport, as on a pointer event. */
  readonly clientX: number;
  /** CSS-pixel coordinate relative to the browser viewport, as on a pointer event. */
  readonly clientY: number;
}

export interface MeshPickTarget {
  readonly kind: 'mesh';
  readonly node: MeshNode;
  /** Stable application identity copied from the picked node. */
  readonly pickingId?: PickingId;
}

export interface GltfPickTarget {
  readonly kind: 'gltf';
  readonly node: GltfNode;
  /** Stable application identity copied from the picked node. */
  readonly pickingId?: PickingId;
}

export interface GltfInstancesPickTarget {
  /** Stable caller identity when supplied by the bulk instance source. */
  readonly instanceId?: PickingId;
  readonly instanceIndex: number;
  readonly kind: 'gltf-instances';
  readonly node: GltfInstancesNode;
  /** Stable application identity copied from the picked node. */
  readonly pickingId?: PickingId;
}

export type PickTarget = MeshPickTarget | GltfPickTarget | GltfInstancesPickTarget;

export interface PickSurface {
  /** Base-colour texture coordinate after the material's authored UV transform, when available. */
  readonly baseColorTextureCoordinates?: readonly [number, number];
  /** Unit surface normal in Royal world space. */
  readonly normal: Direction3;
  /** Whether the hit came from rendered triangles or a caller-authored picking proxy. */
  readonly source: 'rendered' | 'picking-proxy';
}

export interface PickResult {
  /** CSS-pixel coordinate supplied to the pick. */
  readonly clientX: number;
  /** CSS-pixel coordinate supplied to the pick. */
  readonly clientY: number;
  /** Ray distance from the camera to the hit point, in metres. */
  readonly distance: Metres;
  /** Hit point in Royal world space, in metres. */
  readonly point: WorldPosition3;
  /** Exact surface information for spatial tools such as painting and placement. */
  readonly surface: PickSurface;
  readonly target: PickTarget;
}
