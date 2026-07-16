import type { LinearRgba, RenderRoot } from "@royal/renderer-core";
import { captureFailure, type CapturedFailure } from "./captured-failure";
import {
  compileFramePlan,
  createResourceManifestDiffScratch,
  diffResourceManifests,
  type FramePlan,
  type FramePlanResourceManifest,
  type ResourceManifestDelta,
} from "./frame/plan";
import {
  surfaceLightSet,
  type SurfaceLight,
  type SurfaceLightSet,
} from "./webgl/lights";

const EMPTY_RESOURCE_MANIFEST: FramePlanResourceManifest = {
  bulkInstances: [],
  directGeometries: [],
  gltfRequests: [],
  ordinaryTextures: [],
  renderObjectRefs: [],
  virtualTextures: [],
};

export type ScenePlanCapturedFailure = CapturedFailure;

const compileSurfaceLights = (plan: FramePlan): readonly SurfaceLight[] => {
  const scaleColor = (color: LinearRgba, intensity: number): LinearRgba => [
    color[0] * intensity,
    color[1] * intensity,
    color[2] * intensity,
    1,
  ];
  return plan.lightNodes.map((light) => {
    switch (light.kind) {
      case "directional-light":
        return {
          color: scaleColor(light.color, light.illuminanceLux),
          direction: light.direction,
          kind: "directional",
        };
      case "point-light":
        return {
          color: scaleColor(light.color, light.intensityCandela),
          kind: "point",
          position: light.position,
          ...(light.range === undefined ? {} : { range: light.range }),
        };
      case "spot-light":
        return {
          color: scaleColor(light.color, light.intensityCandela),
          direction: light.direction,
          innerConeAngle: light.innerConeAngle,
          kind: "spot",
          outerConeAngle: light.outerConeAngle,
          position: light.position,
          ...(light.range === undefined ? {} : { range: light.range }),
        };
    }
  });
};

export type ScenePlanPlanningSnapshot = Readonly<{
  compileNodeVisits: number;
  planCompiles: number;
  planRevision: number;
  sceneCommits: number;
}>;

export type ScenePlanTransactionOwnerOptions = Readonly<{
  rebuildTopology: (plan: FramePlan) => void;
  reconcileBulkInstances: (changes: ResourceManifestDelta["bulkInstances"]) => void;
  reconcileRenderObjectRefs: (
    plan: FramePlan,
    changes: ResourceManifestDelta["renderObjectRefs"],
  ) => void;
}>;

export type ScenePlanCommitResult<Changes> =
  | Readonly<{ kind: "committed"; plan: FramePlan; resourceChanges: Changes }>
  | Readonly<{ kind: "retained"; plan: FramePlan }>;

/** Owns authoritative scene-plan generations and their retryable reconciliation. */
export class ScenePlanTransactionOwner {
  readonly #diffScratch = createResourceManifestDiffScratch();
  readonly #options: ScenePlanTransactionOwnerOptions;
  #compileNodeVisits = 0;
  #pendingDelta: ResourceManifestDelta | undefined;
  #plan: FramePlan | undefined;
  #planCompiles = 0;
  #reconciling = false;
  #sceneCommits = 0;
  #surfaceLights: readonly SurfaceLight[] = [];
  #surfaceLightSet: SurfaceLightSet | undefined;
  #topologyPending = false;

  constructor(options: ScenePlanTransactionOwnerOptions) {
    this.#options = options;
  }

  get latestScene(): RenderRoot | undefined {
    return this.#plan?.scene;
  }

  get plan(): FramePlan | undefined {
    return this.#plan;
  }

  get reconciling(): boolean {
    return this.#reconciling;
  }

  get sceneSurfaceLights(): readonly SurfaceLight[] {
    return this.#surfaceLights;
  }

  get sceneSurfaceLightSet(): SurfaceLightSet | undefined {
    return this.#surfaceLightSet;
  }

  planningSnapshot(): ScenePlanPlanningSnapshot {
    return {
      compileNodeVisits: this.#compileNodeVisits,
      planCompiles: this.#planCompiles,
      planRevision: this.#plan?.revision ?? 0,
      sceneCommits: this.#sceneCommits,
    };
  }

  commit<Changes>(
    scene: RenderRoot,
    applyResourceDelta: (delta: ResourceManifestDelta) => Changes,
  ): ScenePlanCommitResult<Changes> {
    if (this.#reconciling) {
      throw new Error("Cannot render while Royal is reconciling render-object refs");
    }
    if (this.#pendingDelta !== undefined) this.finishReconciliation();
    const previous = this.#plan;
    if (previous?.scene === scene) return { kind: "retained", plan: previous };

    const next = compileFramePlan(scene, (previous?.revision ?? 0) + 1);
    const delta = diffResourceManifests(
      previous?.manifest ?? EMPTY_RESOURCE_MANIFEST,
      next.manifest,
      this.#diffScratch,
    );
    const lights = compileSurfaceLights(next);
    // The resource arena is the semantic authority. Do not publish the plan if
    // it rejects the matching delta.
    const resourceChanges = applyResourceDelta(delta);
    this.#plan = next;
    this.#surfaceLights = lights;
    this.#surfaceLightSet = lights.length === 0 ? undefined : surfaceLightSet(lights);
    this.#planCompiles += 1;
    this.#compileNodeVisits += next.nodes.length;
    this.#sceneCommits += 1;
    this.#pendingDelta = delta;
    this.#topologyPending = true;
    return { kind: "committed", plan: next, resourceChanges };
  }

  finishReconciliation(initialFailure?: ScenePlanCapturedFailure): void {
    if (this.#reconciling) {
      throw new Error("Render-object ref reconciliation is already in progress");
    }
    const plan = this.#plan;
    const delta = this.#pendingDelta;
    if (plan === undefined || delta === undefined) return;
    this.#reconciling = true;
    try {
      let firstFailure = initialFailure;
      if (this.#topologyPending) {
        const topologyFailure = captureFailure(() => this.#options.rebuildTopology(plan));
        if (topologyFailure === undefined) this.#topologyPending = false;
        else firstFailure ??= topologyFailure;
      }
      const renderObjectRefFailure = captureFailure(() => {
        this.#options.reconcileRenderObjectRefs(plan, delta.renderObjectRefs);
      });
      firstFailure ??= renderObjectRefFailure;
      const bulkFailure = captureFailure(() => {
        this.#options.reconcileBulkInstances(delta.bulkInstances);
      });
      firstFailure ??= bulkFailure;
      if (firstFailure !== undefined) throw firstFailure.value;
      this.#pendingDelta = undefined;
    } finally {
      this.#reconciling = false;
    }
  }
}
