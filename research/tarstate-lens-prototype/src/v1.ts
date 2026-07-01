import {
  evaluate,
  write,
  type Query,
  type QueryResult,
  type RelationRef,
  type WritePatch
} from '@tarstate/core';
import {
  createStableRoyalAppBoundary,
  createStableRoyalLensSnapshot,
  createStorePatchDispatcher,
  stableRoyalActivationPatchRoute,
  stableRoyalEffectResultPatchRoute,
  stableRoyalLensSchema,
  stableRoyalQueries,
  type CapabilityRuntimeState,
  type EffectResultRow,
  type LensSnapshot,
  type ReadableStore,
  type RoyalAppBoundary,
  type RoyalCapabilityResultRow,
  type RoyalDocumentState,
  type RoyalInteractionState,
  type RoyalLayoutRuntimeState,
  type RoyalPickProbeRow,
  type RoyalRenderRow,
  type StableRoyalLensStores,
  type StorePatchDispatcher,
  type StorePatchRouteResult,
  type WritableStore
} from './stable.js';

export {
  assetIdForSrc,
  royalCapabilityBoundaryContract,
  stableContainmentId
} from './stable.js';
export type {
  CapabilityRuntimeState,
  EffectResultRow,
  LensProbe,
  LensSnapshot,
  RoyalActivationStateRow,
  RoyalAppBoundary,
  RoyalAssetDiagnosticRow,
  RoyalAssetFailureInput,
  RoyalAssetRow,
  RoyalCapabilityResultRow,
  RoyalDocumentState,
  RoyalInteractionState,
  RoyalLayoutBoxRow,
  RoyalLayoutRuntimeState,
  RoyalLayoutSpecInput,
  RoyalPickTargetRow,
  RoyalPickProbeRow,
  RoyalPointerSampleRow,
  RoyalRenderFlagRow,
  RoyalRenderRow,
  RoyalScopeRow
} from './stable.js';

export type RoyalReadableStore<State> = ReadableStore<State>;
export type RoyalWritableStore<State> = WritableStore<State>;
export type RoyalLensStores = {
  readonly capabilityStore?: ReadableStore<CapabilityRuntimeState>;
  readonly documentStore?: ReadableStore<RoyalDocumentState>;
  readonly interactionStore: ReadableStore<RoyalInteractionState>;
  readonly layoutStore: ReadableStore<RoyalLayoutRuntimeState>;
};
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
    };

export type RoyalActivationWrite = {
  readonly scopeId: string;
  readonly activationCount?: number;
  readonly activeId?: string;
  readonly focusedId?: string;
  readonly hoveredId?: string;
};

export type RoyalEffectResultWrite = EffectResultRow;

export const royalLensSchema = stableRoyalLensSchema;

export const royalQueries = {
  renderRows: stableRoyalQueries.renderRows satisfies Query<RoyalRenderRow>,
  pickProbeRows: stableRoyalQueries.pickProbeRows satisfies Query<RoyalPickProbeRow>,
  capabilityResultRows: stableRoyalQueries.capabilityResultRows satisfies Query<RoyalCapabilityResultRow>
} as const;

export function createRoyalLensSnapshot(input: RoyalLensStores): LensSnapshot {
  return createStableRoyalLensSnapshot(stableRoyalLensStores(input));
}

export function createRoyalAppBoundary(input: RoyalLensStores): RoyalAppBoundary {
  return createStableRoyalAppBoundary(stableRoyalLensStores(input));
}

export async function evaluateRoyalLens<Row>(
  input: RoyalLensStores,
  query: Query<Row>
): Promise<QueryResult<Row>> {
  return evaluate(createRoyalLensSnapshot(input).source, query);
}

export function createRoyalPatchDispatcher(input: RoyalPatchDispatcherInput): RoyalPatchDispatcher {
  return createStorePatchDispatcher(isRoyalPatchRouteArray(input) ? input : routesFromInput(input));
}

export function writeRoyalActivation(input: RoyalActivationWrite): WritePatch<typeof royalLensSchema.activationStates> {
  const { scopeId, ...changes } = input;
  return write(royalLensSchema.activationStates).update(scopeId, changes);
}

export function writeRoyalEffectResult(input: RoyalEffectResultWrite): WritePatch<typeof royalLensSchema.effectResults> {
  return write(royalLensSchema.effectResults).upsert(input);
}

function routesFromInput(input: Exclude<RoyalPatchDispatcherInput, readonly RoyalPatchRoute[]>): readonly RoyalPatchRoute[] {
  return [
    ...(input.routes ?? []),
    ...(input.interactionStore === undefined ? [] : [stableRoyalActivationPatchRoute(input.interactionStore)]),
    ...(input.capabilityStore === undefined ? [] : [stableRoyalEffectResultPatchRoute(input.capabilityStore)])
  ];
}

function isRoyalPatchRouteArray(input: RoyalPatchDispatcherInput): input is readonly RoyalPatchRoute[] {
  return Array.isArray(input);
}

function stableRoyalLensStores(input: RoyalLensStores): StableRoyalLensStores {
  return {
    ...(input.capabilityStore === undefined ? {} : { capabilityStore: input.capabilityStore }),
    ...(input.documentStore === undefined ? {} : { documentStore: input.documentStore }),
    interactionStore: input.interactionStore,
    layoutStore: input.layoutStore
  };
}
