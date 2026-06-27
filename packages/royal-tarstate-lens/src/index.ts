import {
  anchoredPath,
  and,
  as,
  boolean as bool,
  defineSchema,
  eq,
  evaluate,
  from,
  id,
  join,
  leftJoin,
  maybe,
  number,
  optional,
  pipe,
  project,
  ref,
  relation,
  string,
  type Query,
  type QueryResult,
  type RelationLookup,
  type RelationRef,
  type RelationSource,
  type TarstateDiagnostic,
  type WritePatch
} from '@tarstate/core';

export type ReadableStore<State> = {
  readonly getState: () => State;
  readonly subscribe?: (listener: () => void) => () => void;
};

export type WritableStore<State> = ReadableStore<State> & {
  readonly setState: (updater: State | ((previous: State) => State)) => void;
};

export type StoreLensContext = {
  readonly stateFor: <State>(store: ReadableStore<State>) => State;
};

export type StoreLens<State, Row extends Record<string, unknown>> = {
  readonly relation: RelationRef<Row>;
  readonly store: ReadableStore<State>;
  readonly rows: (state: State, context: StoreLensContext) => Iterable<Row>;
  readonly diagnostics?: (state: State, context: StoreLensContext) => Iterable<TarstateDiagnostic>;
};

export type RowOf<Relation extends RelationRef> = Relation extends RelationRef<infer Row> ? Row : never;

export type LensProbe = {
  readonly relationNames: readonly string[];
  readonly diagnostics: readonly TarstateDiagnostic[];
  readonly rowCount: (relation: string | RelationRef) => number;
  readonly rows: <Relation extends RelationRef>(relation: Relation) => readonly RowOf<Relation>[];
};

export type LensSnapshot = {
  readonly source: RelationSource;
  readonly probe: LensProbe;
};

export type LensSnapshotOptions = {
  readonly diagnostics?: (probe: LensProbe) => Iterable<TarstateDiagnostic>;
};

export type StorePatchDispatcher = {
  readonly dispatch: (patches: Iterable<WritePatch>) => StorePatchDispatchResult;
};

export type StorePatchRouteResult = {
  readonly applied: boolean;
  readonly diagnostics?: readonly TarstateDiagnostic[];
};

export type StorePatchDispatchResult = {
  readonly patches: number;
  readonly applied: number;
  readonly diagnostics: readonly TarstateDiagnostic[];
};

export type RoyalAppBoundary = {
  readonly snapshot: () => LensSnapshot;
  readonly probe: () => LensProbe;
  readonly query: <Row>(query: Query<Row>) => Promise<QueryResult<Row>>;
};

export type CapabilityBoundaryContract = {
  readonly appMayReadRawStoreState: false;
  readonly appMayUseBrowserHandles: false;
  readonly appMayUseRendererHandles: false;
  readonly appInputs: readonly string[];
  readonly adapterOnly: readonly string[];
  readonly leakCodes: readonly CapabilityDiagnosticCode[];
};

export type CapabilityDiagnosticCode =
  | 'activation_required'
  | 'permission_denied'
  | 'stale_snapshot'
  | 'resource_lost'
  | 'backpressure_dropped'
  | 'unsupported'
  | 'policy_denied'
  | 'partial_failure';

export type AnyStorePatchRoute = {
  readonly relation: RelationRef;
  readonly apply: (patch: WritePatch) => StorePatchRouteResult;
};

export type EffectIntentInput = {
  readonly intentId: string;
  readonly capabilityId: string;
  readonly kind: string;
  readonly resourceId: string;
  readonly payloadKind: string;
  readonly sequence: number;
};

export type EffectResultInput = {
  readonly resultId: string;
  readonly intentId: string;
  readonly capabilityId: string;
  readonly resourceId: string;
  readonly status: 'dropped' | 'failed' | 'ok' | 'partial' | 'queued';
  readonly message?: string;
  readonly sequence: number;
};

export type CapabilityDiagnosticInput = {
  readonly diagnosticId: string;
  readonly code: CapabilityDiagnosticCode;
  readonly capabilityId: string;
  readonly message: string;
  readonly relationName?: string;
  readonly resultId?: string;
  readonly resourceId?: string;
  readonly sequence: number;
};

export type CapabilityRuntimeState = {
  readonly scopeId: string;
  readonly diagnostics: readonly CapabilityDiagnosticInput[];
  readonly intents: readonly EffectIntentInput[];
  readonly results: readonly EffectResultInput[];
};

export type CellGridInput = {
  readonly columns: number;
  readonly rows: number;
};

export type CellRectInput = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type RoyalInteractionInput = {
  readonly disabled?: boolean;
  readonly group?: string;
  readonly label: string;
  readonly role: string;
};

export type RoyalGltfInput = {
  readonly src: string;
};

export type RoyalLayoutSpecInput = {
  readonly id?: string;
  readonly objectId?: string;
  readonly label: string;
  readonly primitive?: string;
  readonly tone: string;
  readonly text?: string;
  readonly interaction?: RoyalInteractionInput;
  readonly gltf?: RoyalGltfInput;
  readonly children?: readonly RoyalLayoutSpecInput[];
};

export type RoyalLayoutBoxInput = CellRectInput & {
  readonly id: string;
  readonly interaction?: RoyalInteractionInput;
  readonly label: string;
  readonly primitive: string;
  readonly text?: string;
  readonly tone: string;
  readonly gltf?: RoyalGltfInput;
};

export type RoyalPickTargetInput = {
  readonly bounds: {
    readonly rect: CellRectInput;
    readonly space: string;
  };
  readonly id: string;
  readonly interaction: RoyalInteractionInput;
  readonly kind: string;
  readonly label: string;
  readonly layer: number;
};

export type RoyalPointerSampleInput = {
  readonly sampleId: string;
  readonly sequence: number;
  readonly kind: 'down' | 'leave' | 'move' | 'up';
  readonly x: number;
  readonly y: number;
  readonly targetId: string | undefined;
};

export type RoyalAssetFailureInput = {
  readonly id: string;
  readonly message: string;
  readonly src: string;
};

export type RoyalDocumentState = {
  readonly scopeId: string;
  readonly root: RoyalLayoutSpecInput;
};

export type RoyalLayoutRuntimeState = {
  readonly scopeId: string;
  readonly compact: boolean;
  readonly grid: CellGridInput;
  readonly boxes: readonly RoyalLayoutBoxInput[];
  readonly pickTargets: readonly RoyalPickTargetInput[];
};

export type RoyalInteractionState = {
  readonly scopeId: string;
  readonly activeId: string | undefined;
  readonly activationCount: number;
  readonly focusedId: string | undefined;
  readonly hoveredId: string | undefined;
  readonly geometryFailures: readonly RoyalAssetFailureInput[];
  readonly geometryStatus: string;
  readonly pointerSamples: readonly RoyalPointerSampleInput[];
};

export type RoyalLensStores = {
  readonly capabilityStore?: ReadableStore<CapabilityRuntimeState>;
  readonly documentStore?: ReadableStore<RoyalDocumentState>;
  readonly layoutStore: ReadableStore<RoyalLayoutRuntimeState>;
  readonly interactionStore: ReadableStore<RoyalInteractionState>;
};

export type EffectIntentRow = EffectIntentInput & {
  readonly scopeId: string;
};

export type EffectResultRow = EffectResultInput & {
  readonly scopeId: string;
};

export type CapabilityDiagnosticRow = {
  readonly scopeId: string;
  readonly diagnosticId: string;
  readonly code: CapabilityDiagnosticCode;
  readonly capabilityId: string;
  readonly message: string;
  readonly relationName?: string;
  readonly resultId?: string;
  readonly resourceId?: string;
  readonly sequence: number;
};

export type RoyalScopeRow = {
  readonly scopeId: string;
  readonly compact: boolean;
  readonly gridColumns: number;
  readonly gridRows: number;
};

export type RoyalLayoutNodeRow = {
  readonly scopeId: string;
  readonly nodeId: string;
  readonly parentNodeId?: string;
  readonly path: readonly unknown[];
  readonly order: number;
  readonly label: string;
  readonly primitive: string;
  readonly tone: string;
  readonly role?: string;
  readonly group?: string;
  readonly assetId?: string;
};

export type RoyalLayoutBoxRow = {
  readonly scopeId: string;
  readonly boxId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly primitive: string;
  readonly tone: string;
  readonly text?: string;
  readonly hasInteraction: boolean;
  readonly assetId?: string;
};

export type RoyalPickTargetRow = {
  readonly scopeId: string;
  readonly targetId: string;
  readonly boxId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly role: string;
  readonly label: string;
  readonly group?: string;
  readonly layer: number;
  readonly disabled: boolean;
};

export type RoyalRenderFlagRow = {
  readonly scopeId: string;
  readonly boxId: string;
  readonly active: boolean;
  readonly focused: boolean;
  readonly hovered: boolean;
};

export type RoyalActivationStateRow = {
  readonly scopeId: string;
  readonly activationCount: number;
  readonly activeId?: string;
  readonly focusedId?: string;
  readonly hoveredId?: string;
};

export type RoyalPointerSampleRow = {
  readonly scopeId: string;
  readonly sampleId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly targetId?: string;
};

export type RoyalAssetRow = {
  readonly scopeId: string;
  readonly assetId: string;
  readonly src: string;
  readonly kind: string;
  readonly ownerNodeId: string;
};

export type RoyalAssetDiagnosticRow = {
  readonly scopeId: string;
  readonly diagnosticId: string;
  readonly assetId: string;
  readonly src: string;
  readonly message: string;
  readonly status: string;
};

export type RoyalRenderRow = {
  readonly scopeId: string;
  readonly boxId: string;
  readonly label: string;
  readonly primitive: string;
  readonly tone: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly active: boolean | undefined;
  readonly focused: boolean | undefined;
  readonly hovered: boolean | undefined;
};

export type RoyalCapabilityResultRow = {
  readonly scopeId: string;
  readonly resultId: string;
  readonly intentId: string;
  readonly capabilityId: string;
  readonly resourceId: string;
  readonly status: string;
  readonly message: string | undefined;
  readonly diagnosticCode: CapabilityDiagnosticCode | undefined;
};

export type RoyalPickProbeRow = {
  readonly scopeId: string;
  readonly sampleId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly targetId: string | undefined;
  readonly targetRole: string | undefined;
  readonly targetLabel: string | undefined;
};

export const royalLensSchema = defineSchema({
  scopes: relation<RoyalScopeRow>({
    key: 'scopeId',
    fields: {
      scopeId: id('royalScope'),
      compact: bool(),
      gridColumns: number(),
      gridRows: number()
    }
  }),
  layoutNodes: relation<RoyalLayoutNodeRow>({
    key: ['scopeId', 'nodeId'],
    fields: {
      scopeId: id('royalScope'),
      nodeId: id('royalNode'),
      parentNodeId: optional(ref('layoutNodes.nodeId')),
      path: anchoredPath(),
      order: number(),
      label: string(),
      primitive: string(),
      tone: string(),
      role: optional(string()),
      group: optional(string()),
      assetId: optional(ref('assets.assetId'))
    }
  }),
  layoutBoxes: relation<RoyalLayoutBoxRow>({
    key: ['scopeId', 'boxId'],
    fields: {
      scopeId: id('royalScope'),
      boxId: id('royalBox'),
      x: number(),
      y: number(),
      width: number(),
      height: number(),
      label: string(),
      primitive: string(),
      tone: string(),
      text: optional(string()),
      hasInteraction: bool(),
      assetId: optional(ref('assets.assetId'))
    }
  }),
  pickTargets: relation<RoyalPickTargetRow>({
    key: ['scopeId', 'targetId'],
    fields: {
      scopeId: id('royalScope'),
      targetId: id('royalPickTarget'),
      boxId: ref('layoutBoxes.boxId'),
      x: number(),
      y: number(),
      width: number(),
      height: number(),
      role: string(),
      label: string(),
      group: optional(string()),
      layer: number(),
      disabled: bool()
    }
  }),
  renderFlags: relation<RoyalRenderFlagRow>({
    key: ['scopeId', 'boxId'],
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      boxId: ref('layoutBoxes.boxId'),
      active: bool(),
      focused: bool(),
      hovered: bool()
    }
  }),
  activationStates: relation<RoyalActivationStateRow>({
    key: 'scopeId',
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      activationCount: number(),
      activeId: optional(ref('pickTargets.targetId')),
      focusedId: optional(ref('pickTargets.targetId')),
      hoveredId: optional(ref('pickTargets.targetId'))
    }
  }),
  pointerSamples: relation<RoyalPointerSampleRow>({
    key: ['scopeId', 'sampleId'],
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      sampleId: id('royalPointerSample'),
      sequence: number(),
      kind: string(),
      x: number(),
      y: number(),
      targetId: optional(ref('pickTargets.targetId'))
    }
  }),
  assets: relation<RoyalAssetRow>({
    key: ['scopeId', 'assetId'],
    fields: {
      scopeId: id('royalScope'),
      assetId: id('royalAsset'),
      src: string(),
      kind: string(),
      ownerNodeId: ref('layoutNodes.nodeId')
    }
  }),
  assetDiagnostics: relation<RoyalAssetDiagnosticRow>({
    key: ['scopeId', 'diagnosticId'],
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      diagnosticId: id('royalAssetDiagnostic'),
      assetId: ref('assets.assetId'),
      src: string(),
      message: string(),
      status: string()
    }
  }),
  effectIntents: relation<EffectIntentRow>({
    key: ['scopeId', 'intentId'],
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      intentId: id('effectIntent'),
      capabilityId: id('capability'),
      kind: string(),
      resourceId: id('resource'),
      payloadKind: string(),
      sequence: number()
    }
  }),
  effectResults: relation<EffectResultRow>({
    key: ['scopeId', 'resultId'],
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      resultId: id('effectResult'),
      intentId: ref('effectIntents.intentId'),
      capabilityId: id('capability'),
      resourceId: id('resource'),
      status: string(),
      message: optional(string()),
      sequence: number()
    }
  }),
  capabilityDiagnostics: relation<CapabilityDiagnosticRow>({
    key: ['scopeId', 'diagnosticId'],
    ephemeral: true,
    fields: {
      scopeId: id('royalScope'),
      diagnosticId: id('capabilityDiagnostic'),
      code: string(),
      capabilityId: id('capability'),
      message: string(),
      relationName: optional(string()),
      resultId: optional(ref('effectResults.resultId')),
      resourceId: optional(id('resource')),
      sequence: number()
    }
  })
});

const scope = as(royalLensSchema.scopes, 'scope');
const box = as(royalLensSchema.layoutBoxes, 'box');
const target = as(royalLensSchema.pickTargets, 'target');
const flag = as(royalLensSchema.renderFlags, 'flag');
const pointer = as(royalLensSchema.pointerSamples, 'pointer');
const assetDiagnostic = as(royalLensSchema.assetDiagnostics, 'assetDiagnostic');
const effectResult = as(royalLensSchema.effectResults, 'effectResult');
const capabilityDiagnostic = as(royalLensSchema.capabilityDiagnostics, 'capabilityDiagnostic');

export const royalCapabilityBoundaryContract = {
  appMayReadRawStoreState: false,
  appMayUseBrowserHandles: false,
  appMayUseRendererHandles: false,
  appInputs: [
    'tarstate relation rows',
    'tarstate query results',
    'lens probes',
    'effect intents',
    'effect results',
    'diagnostic rows'
  ],
  adapterOnly: [
    'window',
    'document',
    'navigator',
    'DOM nodes',
    'raw store state',
    'renderer roots',
    'browser resource handles'
  ],
  leakCodes: [
    'activation_required',
    'permission_denied',
    'stale_snapshot',
    'resource_lost',
    'backpressure_dropped',
    'unsupported',
    'policy_denied',
    'partial_failure'
  ]
} as const satisfies CapabilityBoundaryContract;

export const royalQueries = {
  renderRows: pipe(
    from(box),
    leftJoin(
      from(flag),
      and(
        eq(box.scopeId, flag.scopeId),
        eq(box.boxId, flag.boxId)
      )
    ),
    project({
      scopeId: box.scopeId,
      boxId: box.boxId,
      label: box.label,
      primitive: box.primitive,
      tone: box.tone,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      active: maybe(flag.active),
      focused: maybe(flag.focused),
      hovered: maybe(flag.hovered)
    })
  ) satisfies Query<RoyalRenderRow>,
  pickProbeRows: pipe(
    from(pointer),
    leftJoin(
      from(target),
      and(
        eq(pointer.scopeId, target.scopeId),
        eq(pointer.targetId, target.targetId)
      )
    ),
    project({
      scopeId: pointer.scopeId,
      sampleId: pointer.sampleId,
      sequence: pointer.sequence,
      kind: pointer.kind,
      x: pointer.x,
      y: pointer.y,
      targetId: maybe(pointer.targetId),
      targetRole: maybe(target.role),
      targetLabel: maybe(target.label)
    })
  ) satisfies Query<RoyalPickProbeRow>,
  assetFailureRows: pipe(
    from(assetDiagnostic),
    project({
      scopeId: assetDiagnostic.scopeId,
      diagnosticId: assetDiagnostic.diagnosticId,
      assetId: assetDiagnostic.assetId,
      src: assetDiagnostic.src,
      message: assetDiagnostic.message,
      status: assetDiagnostic.status
    })
  ),
  capabilityResultRows: pipe(
    from(effectResult),
    leftJoin(
      from(capabilityDiagnostic),
      eq(effectResult.resultId, capabilityDiagnostic.resultId)
    ),
    project({
      scopeId: effectResult.scopeId,
      resultId: effectResult.resultId,
      intentId: effectResult.intentId,
      capabilityId: effectResult.capabilityId,
      resourceId: effectResult.resourceId,
      status: effectResult.status,
      message: maybe(effectResult.message),
      diagnosticCode: maybe(capabilityDiagnostic.code)
    })
  ) satisfies Query<RoyalCapabilityResultRow>,
  scopedCapabilityResultRows: pipe(
    from(effectResult),
    leftJoin(
      from(capabilityDiagnostic),
      and(
        eq(effectResult.scopeId, capabilityDiagnostic.scopeId),
        eq(effectResult.resultId, capabilityDiagnostic.resultId)
      )
    ),
    project({
      scopeId: effectResult.scopeId,
      resultId: effectResult.resultId,
      intentId: effectResult.intentId,
      capabilityId: effectResult.capabilityId,
      resourceId: effectResult.resourceId,
      status: effectResult.status,
      message: maybe(effectResult.message),
      diagnosticCode: maybe(capabilityDiagnostic.code)
    })
  ) satisfies Query<RoyalCapabilityResultRow>,
  scopedTargets: pipe(
    from(scope),
    join(from(target), eq(scope.scopeId, target.scopeId)),
    project({
      scopeId: scope.scopeId,
      compact: scope.compact,
      targetId: target.targetId,
      role: target.role,
      label: target.label,
      layer: target.layer
    })
  )
} as const;

export function createStoreLensSnapshot(
  lenses: readonly StoreLens<unknown, Record<string, unknown>>[],
  options: LensSnapshotOptions = {}
): LensSnapshot {
  const stateByStore = new Map<ReadableStore<unknown>, unknown>();
  const context: StoreLensContext = {
    stateFor: <State>(store: ReadableStore<State>) => {
      if (!stateByStore.has(store as ReadableStore<unknown>)) {
        stateByStore.set(store as ReadableStore<unknown>, store.getState());
      }

      return stateByStore.get(store as ReadableStore<unknown>) as State;
    }
  };
  const data: Record<string, unknown[]> = {};
  const diagnostics: TarstateDiagnostic[] = [];

  for (const lens of lenses) {
    const state = context.stateFor(lens.store);
    data[lens.relation.name] = Array.from(lens.rows(state, context));

    if (lens.diagnostics !== undefined) {
      diagnostics.push(...lens.diagnostics(state, context));
    }
  }

  const probe = createLensProbe(data, diagnostics);

  if (options.diagnostics !== undefined) {
    diagnostics.push(...options.diagnostics(probe));
  }

  return {
    source: createIndexedLensSource(data, diagnostics),
    probe
  };
}

export function createStorePatchDispatcher(routes: readonly AnyStorePatchRoute[]): StorePatchDispatcher {
  const routeByRelation = new Map(routes.map((route) => [route.relation.name, route]));

  return {
    dispatch: (patches) => {
      const diagnostics: TarstateDiagnostic[] = [];
      let patchCount = 0;
      let applied = 0;

      for (const patch of patches) {
        patchCount += 1;
        const route = routeByRelation.get(patch.relation.name);

        if (route === undefined) {
          diagnostics.push({
            code: 'unsupported_lookup',
            message: `no store patch route for relation ${patch.relation.name}`,
            relation: patch.relation.name
          });
          continue;
        }

        const result = route.apply(patch);

        diagnostics.push(...(result.diagnostics ?? []));

        if (result.applied) {
          applied += 1;
        }
      }

      return { patches: patchCount, applied, diagnostics };
    }
  };
}

export function createRoyalStoreLenses(stores: RoyalLensStores): readonly StoreLens<unknown, Record<string, unknown>>[] {
  const lenses: StoreLens<unknown, Record<string, unknown>>[] = [
    {
      relation: royalLensSchema.scopes,
      store: stores.layoutStore,
      rows: (state) => [deriveScopeRow(state as RoyalLayoutRuntimeState)]
    },
    {
      relation: royalLensSchema.layoutBoxes,
      store: stores.layoutStore,
      rows: (state) => deriveLayoutBoxRows(state as RoyalLayoutRuntimeState)
    },
    {
      relation: royalLensSchema.pickTargets,
      store: stores.layoutStore,
      rows: (state) => derivePickTargetRows(state as RoyalLayoutRuntimeState)
    },
    {
      relation: royalLensSchema.activationStates,
      store: stores.interactionStore,
      rows: (state) => [deriveActivationStateRow(state as RoyalInteractionState)]
    },
    {
      relation: royalLensSchema.renderFlags,
      store: stores.interactionStore,
      rows: (state) => deriveRenderFlagRows(state as RoyalInteractionState)
    },
    {
      relation: royalLensSchema.pointerSamples,
      store: stores.interactionStore,
      rows: (state) => derivePointerSampleRows(state as RoyalInteractionState)
    },
    {
      relation: royalLensSchema.assetDiagnostics,
      store: stores.interactionStore,
      rows: (state) => deriveAssetDiagnosticRows(state as RoyalInteractionState)
    }
  ];

  if (stores.capabilityStore !== undefined) {
    lenses.push(
      {
        relation: royalLensSchema.effectIntents,
        store: stores.capabilityStore,
        rows: (state) => deriveEffectIntentRows(state as CapabilityRuntimeState)
      },
      {
        relation: royalLensSchema.effectResults,
        store: stores.capabilityStore,
        rows: (state) => deriveEffectResultRows(state as CapabilityRuntimeState)
      },
      {
        relation: royalLensSchema.capabilityDiagnostics,
        store: stores.capabilityStore,
        rows: (state) => deriveCapabilityDiagnosticRows(state as CapabilityRuntimeState)
      }
    );
  }

  if (stores.documentStore !== undefined) {
    lenses.push(
      {
        relation: royalLensSchema.layoutNodes,
        store: stores.documentStore,
        rows: (state) => deriveLayoutNodeRows((state as RoyalDocumentState).root, (state as RoyalDocumentState).scopeId)
      },
      {
        relation: royalLensSchema.assets,
        store: stores.documentStore,
        rows: (state) => deriveAssetRows((state as RoyalDocumentState).root, (state as RoyalDocumentState).scopeId)
      }
    );
  }

  return lenses;
}

export function createRoyalLensSnapshot(stores: RoyalLensStores): LensSnapshot {
  return createStoreLensSnapshot(createRoyalStoreLenses(stores), {
    diagnostics: royalProbeDiagnostics
  });
}

export function createRoyalAppBoundary(stores: RoyalLensStores): RoyalAppBoundary {
  return {
    snapshot: () => createRoyalLensSnapshot(stores),
    probe: () => createRoyalLensSnapshot(stores).probe,
    query: async (query) => evaluate(createRoyalLensSnapshot(stores).source, query)
  };
}

export async function evaluateRoyalLens<Row>(
  stores: RoyalLensStores,
  query: Query<Row>
): Promise<QueryResult<Row>> {
  return evaluate(createRoyalLensSnapshot(stores).source, query);
}

export function deriveLayoutNodeRows(
  root: RoyalLayoutSpecInput,
  scopeId: string
): readonly RoyalLayoutNodeRow[] {
  return deriveLayoutNodeRowsAt(root, scopeId, ['root'], undefined, 0);
}

export function deriveAssetRows(root: RoyalLayoutSpecInput, scopeId: string): readonly RoyalAssetRow[] {
  const rows: RoyalAssetRow[] = [];

  for (const node of deriveLayoutNodeRows(root, scopeId)) {
    if (node.assetId === undefined) {
      continue;
    }

    const src = node.assetId.startsWith('asset:gltf:') ? node.assetId.slice('asset:gltf:'.length) : node.assetId;
    rows.push({
      scopeId,
      assetId: node.assetId,
      src,
      kind: 'gltf',
      ownerNodeId: node.nodeId
    });
  }

  return rows;
}

export function stableContainmentId(scopeId: string, path: readonly unknown[]): string {
  return `${scopeId}:${path.map(pathSegment).join('/')}`;
}

export function assetIdForSrc(src: string): string {
  return `asset:gltf:${src}`;
}

export function royalActivationPatchRoute(store: WritableStore<RoyalInteractionState>): AnyStorePatchRoute {
  return {
    relation: royalLensSchema.activationStates,
    apply: (patch) => applyRoyalActivationPatch(store, patch)
  };
}

export function royalEffectResultPatchRoute(store: WritableStore<CapabilityRuntimeState>): AnyStorePatchRoute {
  return {
    relation: royalLensSchema.effectResults,
    apply: (patch) => applyRoyalEffectResultPatch(store, patch)
  };
}

function createLensProbe(data: Record<string, readonly unknown[]>, diagnostics: readonly TarstateDiagnostic[]): LensProbe {
  return {
    relationNames: Object.keys(data),
    diagnostics,
    rowCount: (relationRef) => data[relationName(relationRef)]?.length ?? 0,
    rows: (relationRef) => (data[relationRef.name] ?? []) as readonly RowOf<typeof relationRef>[]
  };
}

function createIndexedLensSource(
  data: Record<string, readonly unknown[]>,
  diagnostics: readonly TarstateDiagnostic[]
): RelationSource {
  const indexes = new Map<string, Map<unknown, unknown[]>>();

  return {
    relationNames: Object.keys(data),
    rows: (relationRef) => data[relationRef.name] ?? [],
    lookup: (lookup) => indexFor(data, indexes, lookup).get(lookup.value) ?? [],
    diagnostics: () => diagnostics
  };
}

function indexFor(
  data: Record<string, readonly unknown[]>,
  indexes: Map<string, Map<unknown, unknown[]>>,
  lookup: RelationLookup
): Map<unknown, unknown[]> {
  const indexKey = `${lookup.relation.name}.${lookup.field}`;
  const existing = indexes.get(indexKey);

  if (existing !== undefined) {
    return existing;
  }

  const next = new Map<unknown, unknown[]>();

  for (const row of data[lookup.relation.name] ?? []) {
    if (!isRecord(row)) {
      continue;
    }

    const value = row[lookup.field];
    const rows = next.get(value);

    if (rows === undefined) {
      next.set(value, [row]);
    } else {
      rows.push(row);
    }
  }

  indexes.set(indexKey, next);
  return next;
}

function deriveScopeRow(state: RoyalLayoutRuntimeState): RoyalScopeRow {
  return {
    scopeId: state.scopeId,
    compact: state.compact,
    gridColumns: state.grid.columns,
    gridRows: state.grid.rows
  };
}

function deriveLayoutBoxRows(state: RoyalLayoutRuntimeState): readonly RoyalLayoutBoxRow[] {
  return state.boxes.map((layoutBox) => ({
    scopeId: state.scopeId,
    boxId: layoutBox.id,
    x: layoutBox.x,
    y: layoutBox.y,
    width: layoutBox.width,
    height: layoutBox.height,
    label: layoutBox.label,
    primitive: layoutBox.primitive,
    tone: layoutBox.tone,
    hasInteraction: layoutBox.interaction !== undefined,
    ...(layoutBox.text === undefined ? {} : { text: layoutBox.text }),
    ...(layoutBox.gltf === undefined ? {} : { assetId: assetIdForSrc(layoutBox.gltf.src) })
  }));
}

function derivePickTargetRows(state: RoyalLayoutRuntimeState): readonly RoyalPickTargetRow[] {
  return state.pickTargets.map((pickTarget) => ({
    scopeId: state.scopeId,
    targetId: pickTarget.id,
    boxId: pickTarget.id,
    x: pickTarget.bounds.rect.x,
    y: pickTarget.bounds.rect.y,
    width: pickTarget.bounds.rect.width,
    height: pickTarget.bounds.rect.height,
    role: pickTarget.interaction.role,
    label: pickTarget.interaction.label,
    layer: pickTarget.layer,
    disabled: pickTarget.interaction.disabled ?? false,
    ...(pickTarget.interaction.group === undefined ? {} : { group: pickTarget.interaction.group })
  }));
}

function deriveActivationStateRow(state: RoyalInteractionState): RoyalActivationStateRow {
  return {
    scopeId: state.scopeId,
    activationCount: state.activationCount,
    ...(state.activeId === undefined ? {} : { activeId: state.activeId }),
    ...(state.focusedId === undefined ? {} : { focusedId: state.focusedId }),
    ...(state.hoveredId === undefined ? {} : { hoveredId: state.hoveredId })
  };
}

function deriveRenderFlagRows(state: RoyalInteractionState): readonly RoyalRenderFlagRow[] {
  const ids = new Set(
    [state.activeId, state.focusedId, state.hoveredId].filter((input): input is string => input !== undefined)
  );

  return Array.from(ids, (boxId) => ({
    scopeId: state.scopeId,
    boxId,
    active: state.activeId === boxId,
    focused: state.focusedId === boxId || state.activeId === boxId || state.hoveredId === boxId,
    hovered: state.hoveredId === boxId
  }));
}

function derivePointerSampleRows(state: RoyalInteractionState): readonly RoyalPointerSampleRow[] {
  return state.pointerSamples.map((sample) => ({
    scopeId: state.scopeId,
    sampleId: sample.sampleId,
    sequence: sample.sequence,
    kind: sample.kind,
    x: sample.x,
    y: sample.y,
    ...(sample.targetId === undefined ? {} : { targetId: sample.targetId })
  }));
}

function deriveAssetDiagnosticRows(state: RoyalInteractionState): readonly RoyalAssetDiagnosticRow[] {
  return state.geometryFailures.map((failure, index) => ({
    scopeId: state.scopeId,
    diagnosticId: `${state.scopeId}:asset:${index}:${failure.id}`,
    assetId: assetIdForSrc(failure.src),
    src: failure.src,
    message: failure.message,
    status: state.geometryStatus
  }));
}

function deriveEffectIntentRows(state: CapabilityRuntimeState): readonly EffectIntentRow[] {
  return state.intents.map((intent) => ({ scopeId: state.scopeId, ...intent }));
}

function deriveEffectResultRows(state: CapabilityRuntimeState): readonly EffectResultRow[] {
  return state.results.map((result) => ({ scopeId: state.scopeId, ...result }));
}

function deriveCapabilityDiagnosticRows(state: CapabilityRuntimeState): readonly CapabilityDiagnosticRow[] {
  return state.diagnostics.map((diagnostic) => ({ scopeId: state.scopeId, ...diagnostic }));
}

function deriveLayoutNodeRowsAt(
  spec: RoyalLayoutSpecInput,
  scopeId: string,
  path: readonly unknown[],
  parentNodeId: string | undefined,
  order: number
): readonly RoyalLayoutNodeRow[] {
  const nodeId = identityForSpec(scopeId, spec, path);
  const own: RoyalLayoutNodeRow = {
    scopeId,
    nodeId,
    ...(parentNodeId === undefined ? {} : { parentNodeId }),
    path,
    order,
    label: spec.label,
    primitive: spec.primitive ?? 'box',
    tone: spec.tone,
    ...(spec.interaction?.role === undefined ? {} : { role: spec.interaction.role }),
    ...(spec.interaction?.group === undefined ? {} : { group: spec.interaction.group }),
    ...(spec.gltf === undefined ? {} : { assetId: assetIdForSrc(spec.gltf.src) })
  };

  return [
    own,
    ...(spec.children ?? []).flatMap((child, index) =>
      deriveLayoutNodeRowsAt(child, scopeId, [...path, 'children', childPathSegment(child, index)], nodeId, index)
    )
  ];
}

export function royalProbeDiagnostics(probe: LensProbe): readonly TarstateDiagnostic[] {
  const diagnostics: TarstateDiagnostic[] = [];
  const pickTargets = probe.rows(royalLensSchema.pickTargets);
  const targetIds = new Set(pickTargets.map((row) => scopedKey(row.scopeId, row.targetId)));
  const boxIds = new Set(probe.rows(royalLensSchema.layoutBoxes).map((row) => scopedKey(row.scopeId, row.boxId)));
  const assetIds = new Set(probe.rows(royalLensSchema.assets).map((row) => scopedKey(row.scopeId, row.assetId)));

  for (const pickTarget of pickTargets) {
    if (!boxIds.has(scopedKey(pickTarget.scopeId, pickTarget.boxId))) {
      diagnostics.push(missingRef('pick target points at missing layout box', royalLensSchema.pickTargets.name, 'boxId', pickTarget.targetId));
    }
  }

  for (const renderFlag of probe.rows(royalLensSchema.renderFlags)) {
    if (!boxIds.has(scopedKey(renderFlag.scopeId, renderFlag.boxId))) {
      diagnostics.push(missingRef('render flag points at missing layout box', royalLensSchema.renderFlags.name, 'boxId', renderFlag.boxId));
    }
  }

  for (const state of probe.rows(royalLensSchema.activationStates)) {
    for (const field of ['activeId', 'focusedId', 'hoveredId'] as const) {
      const targetId = state[field];
      if (targetId !== undefined && !targetIds.has(scopedKey(state.scopeId, targetId))) {
        diagnostics.push(missingRef(`activation state points at missing ${field}`, royalLensSchema.activationStates.name, field, targetId));
      }
    }
  }

  for (const sample of probe.rows(royalLensSchema.pointerSamples)) {
    if (sample.targetId !== undefined && !targetIds.has(scopedKey(sample.scopeId, sample.targetId))) {
      diagnostics.push(missingRef('pointer sample points at missing pick target', royalLensSchema.pointerSamples.name, 'targetId', sample.sampleId));
    }
  }

  for (const assetFailure of probe.rows(royalLensSchema.assetDiagnostics)) {
    if (!assetIds.has(scopedKey(assetFailure.scopeId, assetFailure.assetId))) {
      diagnostics.push(missingRef('asset diagnostic points at missing asset row', royalLensSchema.assetDiagnostics.name, 'assetId', assetFailure.diagnosticId));
    }

    diagnostics.push({
      code: 'unreadable_ref',
      message: assetFailure.message,
      relation: royalLensSchema.assets.name,
      field: 'src',
      key: assetFailure.assetId
    });
  }

  return diagnostics;
}

function applyRoyalActivationPatch(
  store: WritableStore<RoyalInteractionState>,
  patch: WritePatch
): StorePatchRouteResult {
  const nextState = reduceRoyalActivationPatch(store.getState(), patch);

  if (nextState === undefined) {
    return rejectedStorePatch(patch, `activation route rejected ${patch.op} for ${patch.relation.name}`);
  }

  store.setState(nextState);
  return appliedStorePatch();
}

function applyRoyalEffectResultPatch(
  store: WritableStore<CapabilityRuntimeState>,
  patch: WritePatch
): StorePatchRouteResult {
  const nextState = reduceRoyalEffectResultPatch(store.getState(), patch);

  if (nextState === undefined) {
    return rejectedStorePatch(patch, `effect result route rejected ${patch.op} for ${patch.relation.name}`);
  }

  store.setState(nextState);
  return appliedStorePatch();
}

function reduceRoyalActivationPatch(state: RoyalInteractionState, patch: WritePatch): RoyalInteractionState | undefined {
  if (patch.relation.name !== royalLensSchema.activationStates.name) {
    return undefined;
  }

  switch (patch.op) {
    case 'insert':
    case 'upsert':
      return patch.row.scopeId === state.scopeId ? mergeActivationRow(state, patch.row as RoyalActivationStateRow) : undefined;
    case 'update':
      return keyMatchesScope(patch.key, state.scopeId) ? mergeActivationChanges(state, patch.changes) : undefined;
    case 'delete':
      return keyMatchesScope(patch.key, state.scopeId)
        ? {
            ...state,
            activeId: undefined,
            focusedId: undefined,
            hoveredId: undefined,
            activationCount: 0
          }
        : undefined;
  }
}

function reduceRoyalEffectResultPatch(state: CapabilityRuntimeState, patch: WritePatch): CapabilityRuntimeState | undefined {
  if (patch.relation.name !== royalLensSchema.effectResults.name) {
    return undefined;
  }

  switch (patch.op) {
    case 'insert': {
      const row = patch.row as EffectResultRow;

      if (row.scopeId !== state.scopeId || state.results.some((result) => result.resultId === row.resultId)) {
        return undefined;
      }

      return {
        ...state,
        results: [...state.results, effectResultInputFromRow(row)]
      };
    }
    case 'upsert': {
      const row = patch.row as EffectResultRow;

      if (row.scopeId !== state.scopeId) {
        return undefined;
      }

      const nextResult = effectResultInputFromRow(row);
      const resultIndex = state.results.findIndex((result) => result.resultId === row.resultId);

      return {
        ...state,
        results:
          resultIndex === -1
            ? [...state.results, nextResult]
            : state.results.map((result, index) => (index === resultIndex ? nextResult : result))
      };
    }
    case 'update': {
      const resultId = effectResultIdFromKey(patch.key, state.scopeId);

      if (resultId === undefined) {
        return undefined;
      }

      const resultIndex = state.results.findIndex((result) => result.resultId === resultId);

      if (
        resultIndex === -1 ||
        (patch.changes.scopeId !== undefined && patch.changes.scopeId !== state.scopeId)
      ) {
        return undefined;
      }

      return {
        ...state,
        results: state.results.map((result, index) =>
          index === resultIndex ? mergeEffectResultChanges(result, patch.changes as Partial<EffectResultRow>) : result
        )
      };
    }
    case 'delete': {
      const resultId = effectResultIdFromKey(patch.key, state.scopeId);

      if (resultId === undefined || !state.results.some((result) => result.resultId === resultId)) {
        return undefined;
      }

      return {
        ...state,
        results: state.results.filter((result) => result.resultId !== resultId)
      };
    }
  }
}

function mergeActivationRow(state: RoyalInteractionState, row: RoyalActivationStateRow): RoyalInteractionState {
  return {
    ...state,
    activeId: row.activeId,
    focusedId: row.focusedId,
    hoveredId: row.hoveredId,
    activationCount: row.activationCount
  };
}

function mergeActivationChanges(
  state: RoyalInteractionState,
  changes: Partial<RoyalActivationStateRow>
): RoyalInteractionState {
  return {
    ...state,
    activeId: Object.hasOwn(changes, 'activeId') ? changes.activeId : state.activeId,
    focusedId: Object.hasOwn(changes, 'focusedId') ? changes.focusedId : state.focusedId,
    hoveredId: Object.hasOwn(changes, 'hoveredId') ? changes.hoveredId : state.hoveredId,
    activationCount: changes.activationCount ?? state.activationCount
  };
}

function effectResultInputFromRow(row: EffectResultRow): EffectResultInput {
  return {
    resultId: row.resultId,
    intentId: row.intentId,
    capabilityId: row.capabilityId,
    resourceId: row.resourceId,
    status: row.status as EffectResultInput['status'],
    ...(row.message === undefined ? {} : { message: row.message }),
    sequence: row.sequence
  };
}

function mergeEffectResultChanges(
  result: EffectResultInput,
  changes: Partial<EffectResultRow>
): EffectResultInput {
  return {
    resultId: changes.resultId ?? result.resultId,
    intentId: changes.intentId ?? result.intentId,
    capabilityId: changes.capabilityId ?? result.capabilityId,
    resourceId: changes.resourceId ?? result.resourceId,
    status: (changes.status ?? result.status) as EffectResultInput['status'],
    ...(Object.hasOwn(changes, 'message') ? messagePatch(changes) : messagePatch(result)),
    sequence: changes.sequence ?? result.sequence
  };
}

function messagePatch(result: { readonly message?: string }): Pick<EffectResultInput, 'message'> | Record<string, never> {
  return result.message === undefined ? {} : { message: result.message };
}

function keyMatchesScope(input: unknown, scopeId: string): boolean {
  if (typeof input === 'string') {
    return input === scopeId;
  }

  if (Array.isArray(input)) {
    return input[0] === scopeId;
  }

  return isRecord(input) && input.scopeId === scopeId;
}

function effectResultIdFromKey(input: unknown, scopeId: string): string | undefined {
  if (typeof input === 'string') {
    return input;
  }

  if (Array.isArray(input)) {
    return input[0] === scopeId && typeof input[1] === 'string' ? input[1] : undefined;
  }

  if (!isRecord(input)) {
    return undefined;
  }

  if (input.scopeId !== undefined && input.scopeId !== scopeId) {
    return undefined;
  }

  return typeof input.resultId === 'string' ? input.resultId : undefined;
}

function appliedStorePatch(): StorePatchRouteResult {
  return { applied: true };
}

function rejectedStorePatch(patch: WritePatch, message: string): StorePatchRouteResult {
  return {
    applied: false,
    diagnostics: [
      {
        code: 'invalid_row',
        message,
        relation: patch.relation.name
      }
    ]
  };
}

function identityForSpec(scopeId: string, spec: RoyalLayoutSpecInput, path: readonly unknown[]): string {
  return spec.objectId ?? spec.id ?? stableContainmentId(scopeId, path);
}

function childPathSegment(child: RoyalLayoutSpecInput, index: number): string | number {
  return child.objectId ?? child.id ?? index;
}

function scopedKey(scopeId: string, idValue: string): string {
  return `${scopeId}\u0000${idValue}`;
}

function pathSegment(input: unknown): string {
  return encodeURIComponent(String(input));
}

function relationName(input: string | RelationRef): string {
  return typeof input === 'string' ? input : input.name;
}

function missingRef(message: string, relationNameValue: string, field: string, key: string): TarstateDiagnostic {
  return {
    code: 'missing_ref',
    message,
    relation: relationNameValue,
    field,
    key
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
