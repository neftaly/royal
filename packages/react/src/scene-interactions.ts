import type { PickingId, RenderRoot } from "@royal/renderer-core";
import {
  hasRoyalPointerEventHandlers,
  type RoyalPointerEventHandlers,
  type RoyalPointerEventTarget,
} from "./picking-events";

/** React-owned pointer handlers keyed by stable `pickingId` values declared in the scene. */
export type ScenePointerEvents = Readonly<Record<PickingId, RoyalPointerEventHandlers>>;

export interface RoyalScenePointerEventRegistry {
  readonly hasPointerEventTargets: boolean;
  pointerEventTarget(pickingId: string | undefined): RoyalPointerEventTarget | undefined;
}

export interface RoyalScenePickingIndex {
  count(pickingId: string): number;
}

export const createRoyalScenePickingIndex = (scene: RenderRoot): RoyalScenePickingIndex => {
  const counts = new Map<string, number>();
  for (const node of scene.nodes) {
    if (node.kind !== "mesh" && node.kind !== "gltf" && node.kind !== "gltf-instances") continue;
    if (node.pickingId === undefined) continue;
    counts.set(node.pickingId, (counts.get(node.pickingId) ?? 0) + 1);
  }
  return { count: (pickingId) => counts.get(pickingId) ?? 0 };
};

export const createRoyalScenePointerEventRegistry = (
  pickingIndex: RoyalScenePickingIndex,
  interactions: ScenePointerEvents | undefined,
): RoyalScenePointerEventRegistry => {
  const targets = new Map<string, RoyalPointerEventTarget>();

  for (const [pickingId, handlers] of Object.entries(interactions ?? {})) {
    const count = pickingIndex.count(pickingId);
    if (count === 0) {
      throw new Error(
        `Canvas interaction ${JSON.stringify(pickingId)} requires one scene node with the same pickingId`,
      );
    }
    if (count !== 1) {
      throw new Error(
        `Canvas interaction ${JSON.stringify(pickingId)} is ambiguous because ${count} scene nodes use that pickingId`,
      );
    }
    if (hasRoyalPointerEventHandlers(handlers as Record<string, unknown>)) {
      targets.set(pickingId, { handlers });
    }
  }

  return {
    hasPointerEventTargets: targets.size > 0,
    pointerEventTarget: (pickingId) => pickingId === undefined ? undefined : targets.get(pickingId),
  };
};
