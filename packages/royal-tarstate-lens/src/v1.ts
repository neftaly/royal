import {
  evaluate,
  write,
  type Query,
  type QueryResult,
  type RelationRef,
  type WritePatch
} from '@tarstate/core';
import {
  createRoyalAppBoundary as createPrototypeRoyalAppBoundary,
  createRoyalLensSnapshot as createPrototypeRoyalLensSnapshot,
  createStorePatchDispatcher,
  royalActivationPatchRoute,
  royalEffectResultPatchRoute,
  royalLensSchema,
  royalQueries as prototypeRoyalQueries,
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
  RoyalRenderRow
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
    };

export type RoyalActivationWrite = {
  readonly scopeId: string;
  readonly activationCount?: number;
  readonly activeId?: string;
  readonly focusedId?: string;
  readonly hoveredId?: string;
};

export type RoyalEffectResultWrite = EffectResultRow;

export const royalQueries = {
  renderRows: prototypeRoyalQueries.renderRows satisfies Query<RoyalRenderRow>,
  pickProbeRows: prototypeRoyalQueries.pickProbeRows satisfies Query<RoyalPickProbeRow>,
  capabilityResultRows: prototypeRoyalQueries.scopedCapabilityResultRows satisfies Query<RoyalCapabilityResultRow>
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
    ...(input.interactionStore === undefined ? [] : [royalActivationPatchRoute(input.interactionStore)]),
    ...(input.capabilityStore === undefined ? [] : [royalEffectResultPatchRoute(input.capabilityStore)])
  ];
}

function isRoyalPatchRouteArray(input: RoyalPatchDispatcherInput): input is readonly RoyalPatchRoute[] {
  return Array.isArray(input);
}
