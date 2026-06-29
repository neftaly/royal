import {
  evaluate,
  write,
  type Query,
  type QueryResult,
  type RelationRef,
  type WritePatch
} from '@tarstate/core';
import {
  createPrototypeRoyalAppBoundary,
  createPrototypeRoyalLensSnapshot,
  createPrototypeStorePatchDispatcher,
  prototypeRoyalActivationPatchRoute,
  prototypeRoyalEffectResultPatchRoute,
  prototypeRoyalTerrainAvailabilityPatchRoute,
  royalLensSchema,
  prototypeRoyalQueries,
  type CapabilityRuntimeState,
  type EffectResultRow,
  type LensSnapshot,
  type ReadableStore,
  type RoyalAppBoundary,
  type RoyalCapabilityResultRow,
  type RoyalInteractionState,
  type RoyalLensStores,
  type RoyalPickProbeRow,
  type RoyalRenderRow,
  type RoyalTerrainAssetAvailabilityRow,
  type RoyalTerrainOfflineAssetRow,
  type RoyalTerrainOfflineState,
  type StorePatchDispatcher,
  type StorePatchRouteResult,
  type WritableStore
} from './index.js';

export {
  assetIdForSrc,
  royalCapabilityBoundaryContract,
  royalLensSchema,
  stableContainmentId
} from './index.js';
export type {
  CapabilityRuntimeState,
  EffectResultRow,
  LensProbe,
  LensSnapshot,
  RoyalActivationStateRow,
  RoyalAppBoundary,
  RoyalCapabilityResultRow,
  RoyalDocumentState,
  RoyalInteractionState,
  RoyalLayoutRuntimeState,
  RoyalLensStores,
  RoyalPickProbeRow,
  RoyalRenderRow,
  RoyalTerrainAssetAvailabilityInput,
  RoyalTerrainAssetAvailabilityRow,
  RoyalTerrainAssetInput,
  RoyalTerrainAssetRow,
  RoyalTerrainManifestInput,
  RoyalTerrainManifestRow,
  RoyalTerrainOfflineAssetRow,
  RoyalTerrainOfflineState,
  RoyalTerrainTileInput,
  RoyalTerrainTileRow
} from './index.js';

export type RoyalReadableStore<State> = ReadableStore<State>;
export type RoyalWritableStore<State> = WritableStore<State>;
export type RoyalLensInput = RoyalLensStores;
export type RoyalPatchRoute = {
  readonly relation: RelationRef;
  readonly apply: (patch: WritePatch) => StorePatchRouteResult;
};
export type RoyalPatchDispatcher = StorePatchDispatcher;

export type RoyalPatchDispatcherInput =
  | readonly RoyalPatchRoute[]
  | {
      readonly capabilityStore?: WritableStore<CapabilityRuntimeState>;
      readonly interactionStore?: WritableStore<RoyalInteractionState>;
      readonly routes?: readonly RoyalPatchRoute[];
      readonly terrainStore?: WritableStore<RoyalTerrainOfflineState>;
    };

export type RoyalActivationWrite = {
  readonly scopeId: string;
  readonly activationCount?: number;
  readonly activeId?: string;
  readonly focusedId?: string;
  readonly hoveredId?: string;
};

export type RoyalEffectResultWrite = EffectResultRow;
export type RoyalTerrainAvailabilityWrite = RoyalTerrainAssetAvailabilityRow;

export const royalQueries = {
  renderRows: prototypeRoyalQueries.renderRows satisfies Query<RoyalRenderRow>,
  pickProbeRows: prototypeRoyalQueries.pickProbeRows satisfies Query<RoyalPickProbeRow>,
  capabilityResultRows: prototypeRoyalQueries.capabilityResultRows satisfies Query<RoyalCapabilityResultRow>
} as const;

export const experimentalTerrainQueries = {
  offlineAssetRows: prototypeRoyalQueries.terrainOfflineAssetRows satisfies Query<RoyalTerrainOfflineAssetRow>
} as const;

export function createRoyalLensSnapshot(input: RoyalLensInput): LensSnapshot {
  return createPrototypeRoyalLensSnapshot(input);
}

export function createRoyalAppBoundary(input: RoyalLensInput): RoyalAppBoundary {
  return createPrototypeRoyalAppBoundary(input);
}

export const createRoyalBoundary = createRoyalAppBoundary;

export async function evaluateRoyalLens<Row>(
  input: RoyalLensInput,
  query: Query<Row>
): Promise<QueryResult<Row>> {
  return evaluate(createRoyalLensSnapshot(input).source, query);
}

export function createRoyalPatchDispatcher(input: RoyalPatchDispatcherInput): RoyalPatchDispatcher {
  return createPrototypeStorePatchDispatcher(isRoyalPatchRouteArray(input) ? input : routesFromInput(input));
}

export function writeRoyalActivation(input: RoyalActivationWrite): WritePatch<typeof royalLensSchema.activationStates> {
  const { scopeId, ...changes } = input;
  return write(royalLensSchema.activationStates).update(scopeId, changes);
}

export function writeRoyalEffectResult(input: RoyalEffectResultWrite): WritePatch<typeof royalLensSchema.effectResults> {
  return write(royalLensSchema.effectResults).upsert(input);
}

export function writeExperimentalTerrainAvailability(
  input: RoyalTerrainAvailabilityWrite
): WritePatch<typeof royalLensSchema.terrainAssetAvailability> {
  return write(royalLensSchema.terrainAssetAvailability).upsert(input);
}

function routesFromInput(input: Exclude<RoyalPatchDispatcherInput, readonly RoyalPatchRoute[]>): readonly RoyalPatchRoute[] {
  return [
    ...(input.routes ?? []),
    ...(input.interactionStore === undefined ? [] : [prototypeRoyalActivationPatchRoute(input.interactionStore)]),
    ...(input.capabilityStore === undefined ? [] : [prototypeRoyalEffectResultPatchRoute(input.capabilityStore)]),
    ...(input.terrainStore === undefined ? [] : [prototypeRoyalTerrainAvailabilityPatchRoute(input.terrainStore)])
  ];
}

function isRoyalPatchRouteArray(input: RoyalPatchDispatcherInput): input is readonly RoyalPatchRoute[] {
  return Array.isArray(input);
}
