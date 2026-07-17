import {
  clampOrbitCameraView,
  panOrbitCameraView,
  resolveOrbitCameraView,
  rotateOrbitCameraView,
  zoomOrbitCameraView,
  type Metres,
  type OrbitCameraView,
  type OrbitCameraViewConstraints,
  type OrbitCameraViewOptions,
  type Rads,
} from "@royal/renderer-core";

export type OrbitGestureBehavior = {
  readonly enabled?: boolean | undefined;
  readonly enablePan?: boolean | undefined;
  readonly enableRotate?: boolean | undefined;
  readonly enableZoom?: boolean | undefined;
  readonly maxDistance?: Metres | undefined;
  readonly maxPitch?: Rads | undefined;
  readonly minDistance?: Metres | undefined;
  readonly minPitch?: Rads | undefined;
  readonly onChange?: ((view: OrbitCameraView) => void) | undefined;
  readonly panSpeed?: number | undefined;
  readonly rotateSpeed?: number | undefined;
  readonly zoomSpeed?: number | undefined;
};

export type OrbitGesturePointer = {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly modified: boolean;
  readonly pointerId: number;
};

export type OrbitGestureDecision = {
  readonly capture?: number;
  readonly preventDefault: boolean;
  readonly release?: number;
};

export type OrbitGestureController = {
  cancel(): readonly number[];
  contextMenu(): boolean;
  getView(): OrbitCameraView;
  pointerDown(pointer: OrbitGesturePointer): OrbitGestureDecision;
  pointerEnd(pointerId: number): OrbitGestureDecision;
  pointerMove(pointer: Pick<OrbitGesturePointer, "clientX" | "clientY" | "pointerId">): OrbitGestureDecision;
  setBehavior(behavior: OrbitGestureBehavior): readonly number[];
  setView(view: OrbitCameraViewOptions, clamp: boolean, emitChange: boolean): void;
  wheel(deltaPixels: number): boolean;
};

type PointerContact = Pick<OrbitGesturePointer, "clientX" | "clientY" | "pointerId">;
type Interaction =
  | {
      readonly kind: "drag";
      readonly mode: "orbit" | "pan";
      readonly pointerId: number;
      readonly startView: OrbitCameraView;
      readonly startX: number;
      readonly startY: number;
    }
  | {
      readonly kind: "pinch";
      readonly pointerIds: readonly [number, number];
      readonly startDistance: number;
      readonly startView: OrbitCameraView;
    };

const DEFAULT_PAN_SPEED = 0.0016;
const DEFAULT_ROTATE_SPEED = 0.006;
const DEFAULT_ZOOM_SPEED = 0.0018;
const IGNORED_DECISION: OrbitGestureDecision = Object.freeze({ preventDefault: false });
const PREVENTED_DECISION: OrbitGestureDecision = Object.freeze({ preventDefault: true });

const constraintsFromBehavior = (
  behavior: OrbitGestureBehavior,
): OrbitCameraViewConstraints => ({
  maxDistance: behavior.maxDistance,
  maxPitch: behavior.maxPitch,
  minDistance: behavior.minDistance,
  minPitch: behavior.minPitch,
});

const pointerDistance = (first: PointerContact, second: PointerContact): number =>
  Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);

const sameView = (left: OrbitCameraView, right: OrbitCameraView): boolean =>
  left.distance === right.distance
  && left.pitch === right.pitch
  && left.yaw === right.yaw
  && left.target[0] === right.target[0]
  && left.target[1] === right.target[1]
  && left.target[2] === right.target[2];

/** Applies already-validated behavior constraints to an already-resolved core result. */
const clampResolvedView = (
  view: OrbitCameraView,
  constraints: OrbitCameraViewConstraints,
): OrbitCameraView => {
  const distance = Math.min(
    constraints.maxDistance ?? Infinity,
    Math.max(constraints.minDistance ?? -Infinity, view.distance),
  );
  const pitch = Math.min(
    constraints.maxPitch ?? Infinity,
    Math.max(constraints.minPitch ?? -Infinity, view.pitch),
  );
  if (distance === view.distance && pitch === view.pitch) return view;
  return Object.freeze({ ...view, distance, pitch });
};

/** Environment-free orbit gesture state; DOM ownership belongs to the caller. */
export const createOrbitGestureController = (
  initialView: OrbitCameraViewOptions,
  initialBehavior: OrbitGestureBehavior,
): OrbitGestureController => {
  let behavior = initialBehavior;
  let constraints = constraintsFromBehavior(behavior);
  let interaction: Interaction | undefined;
  const pointers = new Map<number, PointerContact>();
  let view = clampOrbitCameraView(initialView, constraints);
  const commit = (result: OrbitCameraView, emit: boolean): void => {
    if (sameView(view, result)) return;
    view = result;
    if (emit) behavior.onChange?.(view);
  };
  const apply = (next: OrbitCameraViewOptions, clamp: boolean, emit: boolean): void => {
    commit(clamp ? clampOrbitCameraView(next, constraints) : resolveOrbitCameraView(next), emit);
  };
  const applyResolved = (next: OrbitCameraView): void => {
    commit(clampResolvedView(next, constraints), true);
  };
  const cancel = (): readonly number[] => {
    const active = [...pointers.keys()];
    pointers.clear();
    interaction = undefined;
    return active;
  };
  const startPinch = (): boolean => {
    if (behavior.enabled === false || behavior.enableZoom === false) return false;
    const [first, second] = [...pointers.values()];
    if (first === undefined || second === undefined) return false;
    interaction = {
      kind: "pinch",
      pointerIds: [first.pointerId, second.pointerId],
      startDistance: pointerDistance(first, second),
      startView: view,
    };
    return true;
  };
  return {
    cancel,
    contextMenu: () => behavior.enabled !== false && behavior.enablePan !== false,
    getView: () => view,
    pointerDown: (pointer) => {
      if (
        behavior.enabled === false
        || ![0, 1, 2].includes(pointer.button)
        || pointers.size >= 2
      ) return IGNORED_DECISION;
      pointers.set(pointer.pointerId, pointer);
      if (pointers.size >= 2) {
        if (startPinch()) return { capture: pointer.pointerId, preventDefault: true };
        pointers.delete(pointer.pointerId);
        return IGNORED_DECISION;
      }
      const mode = pointer.button === 0 && !pointer.modified ? "orbit" : "pan";
      if (
        (mode === "orbit" && behavior.enableRotate === false)
        || (mode === "pan" && behavior.enablePan === false)
      ) {
        pointers.delete(pointer.pointerId);
        return IGNORED_DECISION;
      }
      interaction = {
        kind: "drag",
        mode,
        pointerId: pointer.pointerId,
        startView: view,
        startX: pointer.clientX,
        startY: pointer.clientY,
      };
      return { capture: pointer.pointerId, preventDefault: true };
    },
    pointerEnd: (pointerId) => {
      if (!pointers.has(pointerId)) return IGNORED_DECISION;
      pointers.delete(pointerId);
      if (interaction?.kind === "pinch" && interaction.pointerIds.includes(pointerId)) interaction = undefined;
      if (interaction?.kind === "drag" && interaction.pointerId === pointerId) interaction = undefined;
      return { preventDefault: false, release: pointerId };
    },
    pointerMove: (pointer) => {
      if (!pointers.has(pointer.pointerId) || behavior.enabled === false) return IGNORED_DECISION;
      pointers.set(pointer.pointerId, pointer);
      if (interaction?.kind === "pinch") {
        if (behavior.enableZoom === false) return PREVENTED_DECISION;
        const first = pointers.get(interaction.pointerIds[0]);
        const second = pointers.get(interaction.pointerIds[1]);
        if (first !== undefined && second !== undefined) {
          applyResolved(
            zoomOrbitCameraView(
              interaction.startView,
              interaction.startDistance - pointerDistance(first, second),
              behavior.zoomSpeed ?? DEFAULT_ZOOM_SPEED,
            ),
          );
        }
      } else if (interaction?.kind === "drag" && interaction.pointerId === pointer.pointerId) {
        const deltaX = pointer.clientX - interaction.startX;
        const deltaY = pointer.clientY - interaction.startY;
        if (interaction.mode === "orbit" && behavior.enableRotate !== false) {
          applyResolved(rotateOrbitCameraView(
            interaction.startView,
            deltaX,
            deltaY,
            behavior.rotateSpeed ?? DEFAULT_ROTATE_SPEED,
          ));
        }
        if (interaction.mode === "pan" && behavior.enablePan !== false) {
          applyResolved(panOrbitCameraView(
            interaction.startView,
            deltaX,
            deltaY,
            behavior.panSpeed ?? DEFAULT_PAN_SPEED,
          ));
        }
      }
      return PREVENTED_DECISION;
    },
    setBehavior: (next) => {
      behavior = next;
      constraints = constraintsFromBehavior(behavior);
      const disabled = behavior.enabled === false
        || (interaction?.kind === "pinch" && behavior.enableZoom === false)
        || (interaction?.kind === "drag" && interaction.mode === "orbit" && behavior.enableRotate === false)
        || (interaction?.kind === "drag" && interaction.mode === "pan" && behavior.enablePan === false);
      const released = disabled ? cancel() : [];
      commit(clampOrbitCameraView(view, constraints), true);
      return released;
    },
    setView: apply,
    wheel: (deltaPixels) => {
      if (behavior.enabled === false || behavior.enableZoom === false) return false;
      applyResolved(zoomOrbitCameraView(view, deltaPixels, behavior.zoomSpeed ?? DEFAULT_ZOOM_SPEED));
      return true;
    },
  };
};
