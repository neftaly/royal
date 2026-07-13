import type {
  EulerRads,
  GltfInstanceTransforms,
  Transform,
  Vec3,
} from "@royal/renderer-core";
import { GltfInstanceChangeTracker } from "./instance-changes";
import {
  identityMat4,
  transformMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";

export interface GltfInstanceTransformReferenceChange {
  readonly nextCount: number;
  readonly previousCount: number;
  readonly resource: GltfInstanceTransforms;
}

export interface GltfInstanceTransformView {
  readonly changes: Pick<GltfInstanceChangeTracker, "activePose" | "activeScale">;
  readonly framePoseVersion: number;
  readonly frameScaleVersion: number;
  readonly rootModels: readonly Mat4[];
  readonly sourceKey: number;
  readonly transforms: readonly Transform[];
}

type GltfInstanceTransformViewState = {
  activeApplied: boolean;
  readonly changes: GltfInstanceChangeTracker;
  framePoseVersion: number;
  frameScaleVersion: number;
  matrixPoseVersion: number;
  matrixScaleVersion: number;
  readonly rootModels: MutableMat4[];
  readonly source: GltfInstanceTransforms;
  readonly sourceKey: number;
  readonly transforms: Transform[];
};

type GltfInstanceTransformSubscription = {
  readonly unsubscribe: () => void;
  readonly views: GltfInstanceTransformViewState;
};

type CapturedFailure = { readonly value: unknown };

const captureFirstFailure = (
  first: CapturedFailure | undefined,
  action: () => void,
): CapturedFailure | undefined => {
  try {
    action();
  } catch (error) {
    return first ?? { value: error };
  }
  return first;
};

export class GltfInstanceTransformRegistry {
  readonly #invalidate: () => void;
  readonly #subscriptions = new Map<GltfInstanceTransforms, GltfInstanceTransformSubscription>();
  readonly #views = new WeakMap<GltfInstanceTransforms, GltfInstanceTransformViewState>();
  #frameActive = false;
  #sourceKey = 1;

  constructor(invalidate: () => void, sourceKey = 1) {
    if (!Number.isSafeInteger(sourceKey) || sourceKey < 1) {
      throw new Error(`Invalid glTF instance-transform source ID ${sourceKey}`);
    }
    this.#invalidate = invalidate;
    this.#sourceKey = sourceKey;
  }

  beginFrame(): void {
    if (this.#frameActive) throw new Error("glTF instance-transform frame is already active");
    this.#frameActive = true;
    for (const subscription of this.#subscriptions.values()) {
      const views = subscription.views;
      views.changes.beginFrame();
      views.framePoseVersion = views.source.poseVersion;
      views.frameScaleVersion = views.source.scaleVersion;
      views.activeApplied = views.matrixPoseVersion === views.framePoseVersion
        && views.matrixScaleVersion === views.frameScaleVersion;
    }
  }

  dispose(): void {
    let firstFailure: CapturedFailure | undefined;
    for (const [source, subscription] of this.#subscriptions) {
      firstFailure = captureFirstFailure(firstFailure, () => {
        subscription.unsubscribe();
        this.#subscriptions.delete(source);
      });
    }
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  endFrame(committed: boolean): void {
    if (!this.#frameActive) return;
    if (!committed) {
      for (const subscription of this.#subscriptions.values()) {
        subscription.views.changes.abortFrame();
      }
    }
    this.#frameActive = false;
  }

  reconcile(changes: readonly GltfInstanceTransformReferenceChange[]): void {
    let firstFailure: CapturedFailure | undefined;
    for (const row of changes) {
      const source = row.resource;
      if (row.previousCount !== 0 || row.nextCount === 0) continue;
      firstFailure = captureFirstFailure(firstFailure, () => {
        if (this.#subscriptions.has(source)) return;
        const views = this.views(source) as GltfInstanceTransformViewState;
        const unsubscribe = source.subscribe((channel, startIndex, count) => {
          views.changes.commit(channel, startIndex, count);
          this.#invalidate();
        });
        this.#subscriptions.set(source, { unsubscribe, views });
      });
    }
    for (const row of changes) {
      if (row.nextCount !== 0) continue;
      const source = row.resource;
      const subscription = this.#subscriptions.get(source);
      if (subscription === undefined) continue;
      firstFailure = captureFirstFailure(firstFailure, () => {
        subscription.unsubscribe();
        this.#subscriptions.delete(source);
      });
    }
    if (firstFailure !== undefined) throw firstFailure.value;
  }

  views(source: GltfInstanceTransforms): GltfInstanceTransformView {
    let views = this.#views.get(source);
    if (views === undefined) {
      if (!Number.isSafeInteger(this.#sourceKey)) {
        throw new Error("Royal glTF instance-transform source ID space is exhausted");
      }
      const transforms: Transform[] = [];
      const rootModels: MutableMat4[] = [];
      for (let index = 0; index < source.count; index += 1) {
        const offset = index * 3;
        transforms.push({
          position: source.positions.subarray(offset, offset + 3) as unknown as Vec3,
          rotation: source.rotations.subarray(offset, offset + 3) as unknown as EulerRads,
          scale: source.scales.subarray(offset, offset + 3) as unknown as Vec3,
        });
        rootModels.push(identityMat4());
      }
      views = {
        activeApplied: false,
        changes: new GltfInstanceChangeTracker(source.count),
        framePoseVersion: source.poseVersion,
        frameScaleVersion: source.scaleVersion,
        matrixPoseVersion: -1,
        matrixScaleVersion: -1,
        rootModels,
        source,
        sourceKey: this.#sourceKey,
        transforms,
      };
      this.#sourceKey += 1;
      this.#views.set(source, views);
    }
    if (this.#frameActive && !views.activeApplied) {
      const pose = views.changes.activePose;
      const scale = views.changes.activeScale;
      const firstWord = Math.min(pose.minDirtyWord, scale.minDirtyWord);
      const lastWord = Math.max(pose.maxDirtyWord, scale.maxDirtyWord);
      for (let wordIndex = firstWord; wordIndex <= lastWord; wordIndex += 1) {
        let word = pose.words[wordIndex]! | scale.words[wordIndex]!;
        while (word !== 0) {
          const bit = 31 - Math.clz32(word & -word);
          const index = wordIndex * 32 + bit;
          if (index < views.transforms.length) {
            transformMat4Into(views.rootModels[index]!, views.transforms[index]);
          }
          word &= word - 1;
        }
      }
      views.activeApplied = true;
      views.matrixPoseVersion = views.framePoseVersion;
      views.matrixScaleVersion = views.frameScaleVersion;
    } else if (
      !this.#frameActive
      && (
        views.matrixPoseVersion !== source.poseVersion
        || views.matrixScaleVersion !== source.scaleVersion
      )
    ) {
      for (let index = 0; index < views.transforms.length; index += 1) {
        transformMat4Into(views.rootModels[index]!, views.transforms[index]);
      }
      views.matrixPoseVersion = source.poseVersion;
      views.matrixScaleVersion = source.scaleVersion;
    }
    return views;
  }
}
