import { describe, expect, it } from 'vitest';
import {
  as,
  defineSchema,
  evaluate,
  from,
  id,
  pipe,
  project,
  relation,
  string,
  write
} from '@tarstate/core';
import {
  createRoyalAppBoundary,
  createRoyalLensSnapshot,
  createStoreLensSnapshot,
  createStorePatchDispatcher,
  deriveLayoutNodeRows,
  royalActivationPatchRoute,
  royalCapabilityBoundaryContract,
  royalEffectResultPatchRoute,
  royalLensSchema,
  royalQueries,
  stableContainmentId,
  type CapabilityRuntimeState,
  type ReadableStore,
  type RoyalDocumentState,
  type RoyalInteractionState,
  type RoyalLayoutRuntimeState,
  type RoyalLayoutSpecInput,
  type StoreLens,
  type WritableStore
} from './index.js';

type User = {
  readonly id: string;
  readonly name: string;
};

type GenericState = {
  readonly users: readonly User[];
};

const genericSchema = defineSchema({
  users: relation<User>({
    key: 'id',
    fields: {
      id: id('user'),
      name: string()
    }
  })
});

const user = as(genericSchema.users, 'user');
const userNames = pipe(from(user), project({ id: user.id, name: user.name }));

describe('tarstate Royal/store lens prototype', () => {
  it('turns a generic immutable store into relation rows without exposing the raw tree', async () => {
    const store = createCountingStore<GenericState>({
      users: [
        { id: 'user-a', name: 'Ava' },
        { id: 'user-b', name: 'Mina' }
      ]
    });
    const lenses: readonly StoreLens<unknown, Record<string, unknown>>[] = [
      {
        relation: genericSchema.users,
        store: store as ReadableStore<unknown>,
        rows: (state) => (state as GenericState).users
      }
    ];

    const snapshot = createStoreLensSnapshot(lenses);
    const result = await evaluate(snapshot.source, userNames);

    expect(store.readCount()).toBe(1);
    expect(Object.hasOwn(snapshot, 'state')).toBe(false);
    expect(snapshot.probe.rowCount(genericSchema.users)).toBe(2);
    expect(snapshot.probe.rows(genericSchema.users)).toEqual(store.peekState().users);
    expect(result).toEqual({
      rows: [
        { id: 'user-a', name: 'Ava' },
        { id: 'user-b', name: 'Mina' }
      ],
      diagnostics: []
    });
  });

  it('queries Royal render flags across separate document, layout, and interaction stores', async () => {
    const stores = createRoyalStores();
    const boundary = createRoyalAppBoundary(stores);
    const snapshot = boundary.snapshot();
    const result = await boundary.query(royalQueries.renderRows);
    const button = result.rows.find((row) => row.boxId === 'button-primary');
    const helmet = result.rows.find((row) => row.boxId === 'helmet');
    const log = result.rows.find((row) => row.boxId === 'log');

    expect(Object.hasOwn(snapshot, 'state')).toBe(false);
    expect(Object.hasOwn(boundary, 'store')).toBe(false);
    expect(Object.hasOwn(boundary, 'window')).toBe(false);
    expect(snapshot.probe.rowCount(royalLensSchema.layoutBoxes)).toBe(stores.layoutStore.getState().boxes.length);
    expect(snapshot.probe.rowCount(royalLensSchema.pickTargets)).toBe(stores.layoutStore.getState().pickTargets.length);
    expect(result.diagnostics).toEqual([]);
    expect(button).toMatchObject({
      active: true,
      focused: true,
      hovered: false,
      label: 'apply'
    });
    expect(helmet).toMatchObject({
      active: false,
      focused: true,
      hovered: true,
      primitive: 'gltfPreview'
    });
    expect(log).toMatchObject({
      active: undefined,
      focused: undefined,
      hovered: undefined
    });
    expect(royalCapabilityBoundaryContract).toMatchObject({
      appMayReadRawStoreState: false,
      appMayUseBrowserHandles: false,
      appMayUseRendererHandles: false
    });
  });

  it('surfaces stale cross-store references and keeps probe rows inspectable', async () => {
    const stores = createRoyalStores({
      interaction: {
        activeId: undefined,
        focusedId: 'missing-target',
        hoveredId: undefined,
        geometryFailures: [
          {
            id: 'helmet',
            message: 'Failed to load glTF: /missing.gltf',
            src: '/missing.gltf'
          }
        ],
        geometryStatus: 'failed',
        pointerSamples: [
          {
            sampleId: 'pointer-stale',
            sequence: 1,
            kind: 'move',
            x: 4,
            y: 5,
            targetId: 'missing-target'
          }
        ]
      }
    });
    const snapshot = createRoyalLensSnapshot(stores);
    const result = await evaluate(snapshot.source, royalQueries.pickProbeRows);
    const diagnostics = result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.relation, diagnostic.field]);

    expect(result.rows).toEqual([
      {
        scopeId: 'royal',
        sampleId: 'pointer-stale',
        sequence: 1,
        kind: 'move',
        x: 4,
        y: 5,
        targetId: 'missing-target',
        targetRole: undefined,
        targetLabel: undefined
      }
    ]);
    expect(diagnostics).toContainEqual(['missing_ref', 'activationStates', 'focusedId']);
    expect(diagnostics).toContainEqual(['missing_ref', 'renderFlags', 'boxId']);
    expect(diagnostics).toContainEqual(['missing_ref', 'pointerSamples', 'targetId']);
    expect(diagnostics).toContainEqual(['missing_ref', 'assetDiagnostics', 'assetId']);
    expect(diagnostics).toContainEqual(['unreadable_ref', 'assets', 'src']);
  });

  it('represents capability leaks as effect result and diagnostic rows', async () => {
    const stores = createRoyalStores({
      capability: {
        intents: [
          {
            intentId: 'intent-fullscreen',
            capabilityId: 'capability:fullscreen',
            kind: 'request_fullscreen',
            resourceId: 'canvas:main',
            payloadKind: 'fullscreen-request',
            sequence: 1
          }
        ],
        results: [
          {
            resultId: 'result-fullscreen',
            intentId: 'intent-fullscreen',
            capabilityId: 'capability:fullscreen',
            resourceId: 'canvas:main',
            status: 'failed',
            message: 'requestFullscreen requires a user gesture',
            sequence: 2
          }
        ],
        diagnostics: [
          {
            diagnosticId: 'diagnostic-fullscreen',
            code: 'activation_required',
            capabilityId: 'capability:fullscreen',
            message: 'requestFullscreen requires a user gesture',
            resultId: 'result-fullscreen',
            resourceId: 'canvas:main',
            sequence: 2
          }
        ]
      }
    });

    const result = await createRoyalAppBoundary(stores).query(royalQueries.capabilityResultRows);

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toEqual([
      {
        scopeId: 'royal',
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'failed',
        message: 'requestFullscreen requires a user gesture',
        diagnosticCode: 'activation_required'
      }
    ]);
  });

  it('uses object ids first and containment paths second for distribution-friendly repeated nodes', () => {
    const repeatedTree: RoyalLayoutSpecInput = {
      label: 'root',
      tone: 'root',
      children: [
        {
          objectId: 'automerge:node-a',
          label: 'remote object',
          tone: 'panel'
        },
        {
          label: 'repeated local',
          tone: 'panel'
        },
        {
          label: 'repeated local',
          tone: 'panel'
        }
      ]
    };

    const rows = deriveLayoutNodeRows(repeatedTree, 'doc-a');

    expect(rows.map((row) => row.nodeId)).toEqual([
      stableContainmentId('doc-a', ['root']),
      'automerge:node-a',
      stableContainmentId('doc-a', ['root', 'children', 1]),
      stableContainmentId('doc-a', ['root', 'children', 2])
    ]);
    expect(rows.map((row) => row.path)).toEqual([
      ['root'],
      ['root', 'children', 'automerge:node-a'],
      ['root', 'children', 1],
      ['root', 'children', 2]
    ]);
  });

  it('routes optional tarstate write patches through store middleware instead of owning state', async () => {
    const stores = createRoyalStores();
    const activations = write(royalLensSchema.activationStates);
    const dispatcher = createStorePatchDispatcher([royalActivationPatchRoute(stores.interactionStore)]);

    const result = dispatcher.dispatch([
      activations.update('royal', {
        activeId: 'helmet',
        activationCount: 2,
        focusedId: 'helmet',
        hoveredId: 'helmet'
      })
    ]);
    const snapshot = createRoyalLensSnapshot(stores);
    const renderRows = await evaluate(snapshot.source, royalQueries.renderRows);
    const helmet = renderRows.rows.find((row) => row.boxId === 'helmet');

    expect(result).toEqual({ patches: 1, applied: 1, diagnostics: [] });
    expect(stores.interactionStore.getState()).toMatchObject({
      activeId: 'helmet',
      activationCount: 2,
      focusedId: 'helmet',
      hoveredId: 'helmet'
    });
    expect(helmet).toMatchObject({
      active: true,
      focused: true,
      hovered: true
    });
  });

  it('routes writer patches to multiple private stores and diagnoses unrouted relations', async () => {
    const stores = createRoyalStores();
    const activations = write(royalLensSchema.activationStates);
    const effectResults = write(royalLensSchema.effectResults);
    const layoutBoxes = write(royalLensSchema.layoutBoxes);
    const activationRoute = royalActivationPatchRoute(stores.interactionStore);
    const effectResultRoute = royalEffectResultPatchRoute(stores.capabilityStore);
    const dispatcher = createStorePatchDispatcher([activationRoute, effectResultRoute]);

    const result = dispatcher.dispatch([
      activations.update('royal', {
        activeId: 'helmet',
        activationCount: 2,
        focusedId: 'helmet',
        hoveredId: 'helmet'
      }),
      effectResults.upsert({
        scopeId: 'royal',
        resultId: 'result-route',
        intentId: 'intent-route',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        sequence: 3
      }),
      layoutBoxes.update({ scopeId: 'royal', boxId: 'helmet' }, { label: 'patched outside layout store' })
    ]);
    const resultRows = await createRoyalAppBoundary(stores).query(royalQueries.capabilityResultRows);
    const storedResult = stores.capabilityStore.getState().results[0];

    expect(Object.hasOwn(activationRoute, 'store')).toBe(false);
    expect(Object.hasOwn(effectResultRoute, 'store')).toBe(false);
    expect(result).toMatchObject({ patches: 3, applied: 2 });
    expect(result.diagnostics).toEqual([
      {
        code: 'unsupported_lookup',
        message: 'no store patch route for relation layoutBoxes',
        relation: 'layoutBoxes'
      }
    ]);
    expect(stores.interactionStore.getState()).toMatchObject({
      activeId: 'helmet',
      activationCount: 2
    });
    expect(storedResult).toEqual({
      resultId: 'result-route',
      intentId: 'intent-route',
      capabilityId: 'capability:fullscreen',
      resourceId: 'canvas:main',
      status: 'ok',
      sequence: 3
    });
    expect(Object.hasOwn(storedResult as object, 'scopeId')).toBe(false);
    expect(resultRows.rows).toContainEqual({
      scopeId: 'royal',
      resultId: 'result-route',
      intentId: 'intent-route',
      capabilityId: 'capability:fullscreen',
      resourceId: 'canvas:main',
      status: 'ok',
      message: undefined,
      diagnosticCode: undefined
    });
  });
});

function createRoyalStores(overrides: {
  readonly capability?: Partial<CapabilityRuntimeState>;
  readonly interaction?: Partial<RoyalInteractionState>;
} = {}): {
  readonly capabilityStore: WritableStore<CapabilityRuntimeState>;
  readonly documentStore: WritableStore<RoyalDocumentState>;
  readonly layoutStore: WritableStore<RoyalLayoutRuntimeState>;
  readonly interactionStore: WritableStore<RoyalInteractionState>;
} {
  const root = createRoyalFixtureSpec();
  const boxes = createRoyalFixtureBoxes();
  const pickTargets = createRoyalFixturePickTargets();
  const helmetTarget = pickTargets.find((target) => target.id === 'helmet');

  return {
    capabilityStore: createStore<CapabilityRuntimeState>({
      scopeId: 'royal',
      diagnostics: [],
      intents: [],
      results: [],
      ...overrides.capability
    }),
    documentStore: createStore<RoyalDocumentState>({
      scopeId: 'royal',
      root: root as RoyalLayoutSpecInput
    }),
    layoutStore: createStore<RoyalLayoutRuntimeState>({
      scopeId: 'royal',
      compact: false,
      grid: { columns: 12, rows: 8 },
      boxes,
      pickTargets
    }),
    interactionStore: createStore<RoyalInteractionState>({
      scopeId: 'royal',
      activeId: 'button-primary',
      activationCount: 1,
      focusedId: 'button-primary',
      hoveredId: 'helmet',
      geometryFailures: [],
      geometryStatus: 'ready',
      pointerSamples: [
        {
          sampleId: 'pointer-helmet',
          sequence: 1,
          kind: 'move',
          x: helmetTarget === undefined ? 0 : helmetTarget.bounds.rect.x + helmetTarget.bounds.rect.width / 2,
          y: helmetTarget === undefined ? 0 : helmetTarget.bounds.rect.y + helmetTarget.bounds.rect.height / 2,
          targetId: 'helmet'
        }
      ],
      ...overrides.interaction
    })
  };
}

function createRoyalFixtureSpec(): RoyalLayoutSpecInput {
  return {
    label: 'root',
    tone: 'root',
    children: [
      {
        id: 'button-primary',
        label: 'apply',
        primitive: 'button',
        tone: 'accent',
        interaction: {
          label: 'apply',
          role: 'button'
        }
      },
      {
        id: 'helmet',
        label: 'Helmet geometry',
        primitive: 'gltfPreview',
        tone: 'media',
        interaction: {
          group: 'media',
          label: 'Helmet geometry',
          role: 'media'
        },
        gltf: {
          src: '/helmet.gltf'
        }
      },
      {
        id: 'log',
        label: 'activity log',
        primitive: 'text',
        tone: 'surface',
        text: 'ready'
      }
    ]
  };
}

function createRoyalFixtureBoxes(): readonly RoyalLayoutRuntimeState['boxes'][number][] {
  return [
    {
      id: 'button-primary',
      x: 1,
      y: 1,
      width: 4,
      height: 2,
      label: 'apply',
      primitive: 'button',
      tone: 'accent',
      interaction: {
        label: 'apply',
        role: 'button'
      }
    },
    {
      id: 'helmet',
      x: 6,
      y: 1,
      width: 5,
      height: 5,
      label: 'Helmet geometry',
      primitive: 'gltfPreview',
      tone: 'media',
      interaction: {
        group: 'media',
        label: 'Helmet geometry',
        role: 'media'
      },
      gltf: {
        src: '/helmet.gltf'
      }
    },
    {
      id: 'log',
      x: 1,
      y: 5,
      width: 4,
      height: 2,
      label: 'activity log',
      primitive: 'text',
      tone: 'surface',
      text: 'ready'
    }
  ];
}

function createRoyalFixturePickTargets(): readonly RoyalLayoutRuntimeState['pickTargets'][number][] {
  return [
    {
      id: 'button-primary',
      bounds: {
        rect: { x: 1, y: 1, width: 4, height: 2 },
        space: 'grid'
      },
      interaction: {
        label: 'apply',
        role: 'button'
      },
      kind: 'box',
      label: 'apply',
      layer: 1
    },
    {
      id: 'helmet',
      bounds: {
        rect: { x: 6, y: 1, width: 5, height: 5 },
        space: 'grid'
      },
      interaction: {
        group: 'media',
        label: 'Helmet geometry',
        role: 'media'
      },
      kind: 'asset',
      label: 'Helmet geometry',
      layer: 2
    }
  ];
}

function createStore<State extends object>(initialState: State): WritableStore<State> {
  let state = initialState;

  return {
    getState: () => state,
    setState: (updater) => {
      state = typeof updater === 'function' ? (updater as (previous: State) => State)(state) : updater;
    }
  };
}

function createCountingStore<State extends object>(initialState: State): WritableStore<State> & {
  readonly peekState: () => State;
  readonly readCount: () => number;
} {
  const store = createStore(initialState);
  let reads = 0;

  return {
    getState: () => {
      reads += 1;
      return store.getState();
    },
    setState: store.setState,
    peekState: store.getState,
    readCount: () => reads
  };
}
