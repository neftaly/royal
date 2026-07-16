import type {
  EulerRads,
  GltfInstanceTransforms,
  Transform,
  Vec3,
} from "@royal/renderer-core";
import {
  areAllInstancesDirty,
  GltfInstanceChangeTracker,
} from "./instance-changes";
import { captureFirstFailure, type CapturedFailure } from "../captured-failure";
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
  readonly changes: Pick<
    GltfInstanceChangeTracker,
    "activePosition" | "activeRotation" | "activeScale"
  >;
  readonly framePoseVersion: number;
  readonly frameScaleVersion: number;
  /** One when the synchronized scale preserves mesh winding, zero when it reverses it. */
  readonly orientationPreserving: Uint8Array;
  readonly positions: Float32Array;
  readonly rotations: Float32Array;
  readonly rootModels: readonly Mat4[];
  readonly scales: Float32Array;
  readonly sourceKey: number;
  readonly transforms: readonly Transform[];
}

type GltfInstanceTransformViewState = {
  activeApplied: boolean;
  readonly changes: GltfInstanceChangeTracker;
  framePoseVersion: number;
  frameScaleVersion: number;
  matrixPoseVersion: number;
  readonly matrixRotations: Float32Array;
  readonly matrixScales: Float32Array;
  matrixScaleVersion: number;
  readonly orientationPreserving: Uint8Array;
  readonly positions: Float32Array;
  readonly rotations: Float32Array;
  readonly rootModels: MutableMat4[];
  readonly scales: Float32Array;
  readonly source: GltfInstanceTransforms;
  readonly sourceKey: number;
  readonly transforms: Transform[];
};

type GltfInstanceTransformSubscription = {
  readonly unsubscribe: () => void;
  readonly views: GltfInstanceTransformViewState;
};

const sameVector3 = (left: Float32Array, right: Float32Array, offset: number): boolean =>
  Object.is(left[offset], right[offset])
  && Object.is(left[offset + 1], right[offset + 1])
  && Object.is(left[offset + 2], right[offset + 2]);

const copyVector3 = (target: Float32Array, source: Float32Array, offset: number): void => {
  target[offset] = source[offset]!;
  target[offset + 1] = source[offset + 1]!;
  target[offset + 2] = source[offset + 2]!;
};

const applyInstanceMatrix = (
  views: GltfInstanceTransformViewState,
  index: number,
  poseDirty: boolean,
  rotationDirty: boolean,
  scaleDirty: boolean,
): void => {
  const offset = index * 3;
  const rotationChanged = rotationDirty
    && !sameVector3(views.matrixRotations, views.source.rotations, offset);
  const scaleChanged = scaleDirty
    && !sameVector3(views.matrixScales, views.source.scales, offset);
  if (rotationChanged || scaleChanged) {
    transformMat4Into(views.rootModels[index]!, views.transforms[index]);
    if (rotationChanged) copyVector3(views.matrixRotations, views.source.rotations, offset);
    if (scaleChanged) {
      copyVector3(views.matrixScales, views.source.scales, offset);
      views.orientationPreserving[index] = views.source.scales[offset]!
        * views.source.scales[offset + 1]!
        * views.source.scales[offset + 2]! >= 0 ? 1 : 0;
    }
    return;
  }
  if (!poseDirty) return;
  const model = views.rootModels[index]!;
  model[12] = views.source.positions[offset]!;
  model[13] = views.source.positions[offset + 1]!;
  model[14] = views.source.positions[offset + 2]!;
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
      const matrixRotations = new Float32Array(source.rotations.length);
      const matrixScales = new Float32Array(source.scales.length);
      const orientationPreserving = new Uint8Array(source.count);
      matrixRotations.fill(NaN);
      matrixScales.fill(NaN);
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
        matrixRotations,
        matrixScales,
        matrixScaleVersion: -1,
        orientationPreserving,
        positions: source.positions,
        rotations: source.rotations,
        rootModels,
        scales: source.scales,
        source,
        sourceKey: this.#sourceKey,
        transforms,
      };
      this.#sourceKey += 1;
      this.#views.set(source, views);
    }
    if (this.#frameActive && !views.activeApplied) {
      const position = views.changes.activePosition;
      const rotation = views.changes.activeRotation;
      const scale = views.changes.activeScale;
      if (rotation.maxDirtyWord < rotation.minDirtyWord
        && scale.maxDirtyWord < scale.minDirtyWord
        && areAllInstancesDirty(position, views.transforms.length)) {
        for (let index = 0; index < views.transforms.length; index += 1) {
          const offset = index * 3;
          const model = views.rootModels[index]!;
          model[12] = views.positions[offset]!;
          model[13] = views.positions[offset + 1]!;
          model[14] = views.positions[offset + 2]!;
        }
        views.activeApplied = true;
        views.matrixPoseVersion = views.framePoseVersion;
        views.matrixScaleVersion = views.frameScaleVersion;
        return views;
      }
      const firstWord = Math.min(position.minDirtyWord, rotation.minDirtyWord, scale.minDirtyWord);
      const lastWord = Math.max(position.maxDirtyWord, rotation.maxDirtyWord, scale.maxDirtyWord);
      for (let wordIndex = firstWord; wordIndex <= lastWord; wordIndex += 1) {
        let word = position.words[wordIndex]!
          | rotation.words[wordIndex]!
          | scale.words[wordIndex]!;
        while (word !== 0) {
          const bitMask = word & -word;
          const bit = 31 - Math.clz32(bitMask);
          const index = wordIndex * 32 + bit;
          if (index < views.transforms.length) {
            applyInstanceMatrix(
              views,
              index,
              ((position.words[wordIndex]! | rotation.words[wordIndex]!) & bitMask) !== 0,
              (rotation.words[wordIndex]! & bitMask) !== 0,
              (scale.words[wordIndex]! & bitMask) !== 0,
            );
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
        applyInstanceMatrix(views, index, true, true, true);
      }
      views.matrixPoseVersion = source.poseVersion;
      views.matrixScaleVersion = source.scaleVersion;
    }
    return views;
  }
}
