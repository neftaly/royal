import type { GltfAssetRef } from "@royal/renderer-core";
import type { Mat4 } from "../math/mat4";
import type { CanonicalEdgeSurface } from "./edge-overlay-scene";
import type { CanonicalDrawSurface } from "./scene-lowering";

type Candidate = Readonly<{ memberIndex: number; surfaceIndex: number }>;
type Buckets = { members: Map<number, Candidate[]>; whole: Map<number, Candidate[]> };
type TransformHash = (model: ArrayLike<number>, offset: number, float32: boolean) => number;

const sameAsset = (left: GltfAssetRef, right: GltfAssetRef): boolean =>
  left.src === right.src && left.version === right.version && left.sceneIndex === right.sceneIndex;

const sameModel = (model: ArrayLike<number>, offset: number, requested: Mat4, float32: boolean): boolean => {
  for (let index = 0; index < 16; index += 1) {
    if (!Object.is(model[offset + index], float32 ? Math.fround(requested[index]!) : requested[index])) return false;
  }
  return true;
};

const candidateOrder = (left: Candidate, right: Candidate): number =>
  left.surfaceIndex - right.surfaceIndex || right.memberIndex - left.memberIndex;

/** Root-owned provenance only: GPU readiness and selected LOD remain live queries. */
export class BorrowedSurfaceSourceIndex {
  readonly #geometry = new Map<string, Buckets>();
  readonly #matches: Candidate[] = [];
  readonly #hash: TransformHash;
  #valid = false;
  #builds = 0;
  #candidates = 0;
  #comparisons = 0;
  #lookups = 0;

  constructor(hash?: TransformHash) {
    const value = new Float64Array(1);
    const bits = new Uint32Array(value.buffer);
    this.#hash = hash ?? ((model, offset, float32) => {
      let result = 2166136261;
      for (let index = 0; index < 16; index += 1) {
        value[0] = float32 ? Math.fround(model[offset + index]!) : model[offset + index]!;
        result = Math.imul(result ^ bits[0]!, 16777619);
        result = Math.imul(result ^ bits[1]!, 16777619);
      }
      return result >>> 0;
    });
  }

  invalidate(): void {
    this.#valid = false;
    this.#geometry.clear();
    this.#matches.length = 0;
    this.#candidates = 0;
  }

  snapshot(): Readonly<{ builds: number; candidates: number; comparisons: number; lookups: number }> {
    return { builds: this.#builds, candidates: this.#candidates, comparisons: this.#comparisons, lookups: this.#lookups };
  }

  /** Borrowed workspace; callers consume it before the next lookup. */
  matches(surfaces: readonly CanonicalDrawSurface[], requested: CanonicalEdgeSurface): readonly Candidate[] {
    if (!this.#valid) this.#build(surfaces);
    this.#lookups += 1;
    const output = this.#matches;
    output.length = 0;
    const buckets = this.#geometry.get(requested.geometry.key);
    if (buckets === undefined) return output;
    const whole = buckets.whole.get(this.#hash(requested.sourceModel, 0, false));
    if (whole !== undefined) for (const candidate of whole) {
      this.#comparisons += 1;
      const surface = surfaces[candidate.surfaceIndex]!;
      if (surface.node.kind !== "gltf"
        || surface.instances?.key !== requested.instances?.key
        || !sameAsset(surface.node.asset, requested.asset)
        || !sameModel(surface.model, 0, requested.sourceModel, false)) continue;
      if (surface.gltfOccurrence === undefined) throw new Error("Royal rendered glTF surface is missing mounted occurrence identity");
      output.push(candidate);
    }
    if (requested.instances === undefined) {
      const members = buckets.members.get(this.#hash(requested.sourceModel, 0, true));
      if (members !== undefined) for (const candidate of members) {
        this.#comparisons += 1;
        const instances = surfaces[candidate.surfaceIndex]!.instances!;
        const source = instances.automaticSourceOccurrences![candidate.memberIndex]!;
        if (sameAsset(source.asset, requested.asset)
          && sameModel(instances.localModels, candidate.memberIndex * 16, requested.sourceModel, true)) output.push(candidate);
      }
    }
    // Preserve the full scan's first-ready surface and automatic-member precedence.
    output.sort(candidateOrder);
    let count = 0;
    for (let index = 0; index < output.length; index += 1) {
      const candidate = output[index]!;
      if (count === 0 || output[count - 1]!.surfaceIndex !== candidate.surfaceIndex) output[count++] = candidate;
    }
    output.length = count;
    return output;
  }

  #add(key: string, hash: number, candidate: Candidate): void {
    let buckets = this.#geometry.get(key);
    if (buckets === undefined) {
      buckets = { members: new Map(), whole: new Map() };
      this.#geometry.set(key, buckets);
    }
    const table = candidate.memberIndex < 0 ? buckets.whole : buckets.members;
    const bucket = table.get(hash);
    if (bucket === undefined) table.set(hash, [candidate]);
    else bucket.push(candidate);
    this.#candidates += 1;
  }

  #build(surfaces: readonly CanonicalDrawSurface[]): void {
    this.invalidate();
    for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
      const surface = surfaces[surfaceIndex]!;
      if (surface.node.kind === "gltf") this.#add(surface.geometry.key, this.#hash(surface.model, 0, false), { memberIndex: -1, surfaceIndex });
      const instances = surface.instances;
      const sources = instances?.automaticSourceOccurrences;
      if (sources === undefined || instances === undefined) continue;
      if (sources.length !== instances.count || instances.localModels.length !== instances.count * 16) {
        throw new Error("Royal automatic instance sources diverged from their transform cohort");
      }
      for (let memberIndex = 0; memberIndex < sources.length; memberIndex += 1) {
        this.#add(sources[memberIndex]!.geometryKey, this.#hash(instances.localModels, memberIndex * 16, true), { memberIndex, surfaceIndex });
      }
    }
    this.#valid = true;
    this.#builds += 1;
  }
}
