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

const PICK_INPUT_FIELDS = ['clientX', 'clientY'] as const;

/** Validates DOM client coordinates before renderer-specific picking work. */
export const validatePickInput: (input: unknown) => asserts input is PickInput = (input) => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Royal pick input must be an object with clientX and clientY coordinates');
  }
  for (const field of Object.keys(input)) {
    if (!PICK_INPUT_FIELDS.includes(field as (typeof PICK_INPUT_FIELDS)[number])) {
      throw new TypeError(`Royal pick input contains unsupported field ${JSON.stringify(field)}`);
    }
  }
  const coordinates = input as Partial<PickInput>;
  if (typeof coordinates.clientX !== 'number' || !Number.isFinite(coordinates.clientX)) {
    throw new TypeError('Royal pick input clientX must be a finite number');
  }
  if (typeof coordinates.clientY !== 'number' || !Number.isFinite(coordinates.clientY)) {
    throw new TypeError('Royal pick input clientY must be a finite number');
  }
};

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
