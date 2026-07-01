import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as v1 from './v1.js';
import {
  createRoyalLensSnapshot,
  createRoyalPatchDispatcher,
  evaluateRoyalLens,
  royalCapabilityBoundaryContract,
  royalLensSchema,
  royalQueries,
  writeRoyalActivation,
  writeRoyalEffectResult,
  type CapabilityRuntimeState,
  type RoyalDocumentState,
  type RoyalInteractionState,
  type RoyalLayoutRuntimeState,
  type RoyalLensStores,
  type RoyalWritableStore
} from './v1.js';

type TestStores = RoyalLensStores & {
  readonly capabilityStore: RoyalWritableStore<CapabilityRuntimeState>;
  readonly documentStore: RoyalWritableStore<RoyalDocumentState>;
  readonly interactionStore: RoyalWritableStore<RoyalInteractionState>;
  readonly layoutStore: RoyalWritableStore<RoyalLayoutRuntimeState>;
};

describe('@royal/tarstate-lens/v1', () => {
  it('exposes a narrow query surface over app-owned stores', async () => {
    const stores = createStores();
    const snapshot = createRoyalLensSnapshot(stores);
    const renderRows = await evaluateRoyalLens(stores, royalQueries.renderRows);

    expect(Object.keys(royalQueries).sort()).toEqual([
      'capabilityResultRows',
      'pickProbeRows',
      'renderRows'
    ]);
    expect(Object.keys(royalLensSchema).sort()).toEqual([
      'activationStates',
      'assetDiagnostics',
      'assets',
      'capabilityDiagnostics',
      'effectIntents',
      'effectResults',
      'layoutBoxes',
      'layoutNodes',
      'pickTargets',
      'pointerSamples',
      'renderFlags',
      'scopes'
    ]);
    expect(Object.hasOwn(snapshot, 'state')).toBe(false);
    expect(snapshot.probe.rowCount(royalLensSchema.layoutBoxes)).toBe(1);
    expect(renderRows.diagnostics).toEqual([]);
    expect(renderRows.rows).toEqual([
      {
        scopeId: 'v1',
        boxId: 'button',
        label: 'Open fullscreen',
        primitive: 'button',
        tone: 'accent',
        x: 1,
        y: 1,
        width: 6,
        height: 2,
        active: false,
        focused: true,
        hovered: true
      }
    ]);
    expect(royalCapabilityBoundaryContract.appMayUseRendererHandles).toBe(false);
  });

  it('routes v1 writer helpers through private stores', async () => {
    const stores = createStores();
    const dispatcher = createRoyalPatchDispatcher({
      capabilityStore: stores.capabilityStore,
      interactionStore: stores.interactionStore
    });

    const result = dispatcher.dispatch([
      writeRoyalActivation({
        scopeId: 'v1',
        activeId: 'button',
        activationCount: 3,
        focusedId: 'button',
        hoveredId: 'button'
      }),
      writeRoyalEffectResult({
        scopeId: 'v1',
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        sequence: 2
      })
    ]);
    const renderRows = await evaluateRoyalLens(stores, royalQueries.renderRows);
    const capabilityRows = await evaluateRoyalLens(stores, royalQueries.capabilityResultRows);

    expect(result).toEqual({ patches: 2, applied: 2, diagnostics: [] });
    expect(stores.interactionStore.getState()).toMatchObject({
      activeId: 'button',
      activationCount: 3,
      focusedId: 'button',
      hoveredId: 'button'
    });
    expect(stores.capabilityStore.getState().results).toEqual([
      {
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        sequence: 2
      }
    ]);
    expect(renderRows.rows[0]).toMatchObject({
      active: true,
      focused: true,
      hovered: true
    });
    expect(capabilityRows.rows).toEqual([
      {
        scopeId: 'v1',
        resultId: 'result-fullscreen',
        intentId: 'intent-fullscreen',
        capabilityId: 'capability:fullscreen',
        resourceId: 'canvas:main',
        status: 'ok',
        message: undefined,
        diagnosticCode: undefined
      }
    ]);
  });

  it('keeps experimental terrain outside the stable facade', () => {
    const stores = createStores();
    const storesWithTerrain = {
      ...stores,
      terrainStore: writableStore({ scopeId: 'v1', manifests: [], tiles: [], assets: [], availability: [] })
    };
    const snapshot = createRoyalLensSnapshot(storesWithTerrain);

    expect(v1).not.toHaveProperty('experimentalTerrainQueries');
    expect(v1).not.toHaveProperty('writeExperimentalTerrainAvailability');
    expect(royalLensSchema).not.toHaveProperty('terrainManifests');
    expect(royalLensSchema).not.toHaveProperty('terrainTiles');
    expect(royalLensSchema).not.toHaveProperty('terrainAssets');
    expect(royalLensSchema).not.toHaveProperty('terrainAssetAvailability');
    expect(snapshot.probe.relationNames.filter((relationName) => relationName.startsWith('terrain'))).toEqual([]);
    expectTypeOf<typeof v1>().not.toHaveProperty('experimentalTerrainQueries');
    expectTypeOf<typeof v1>().not.toHaveProperty('writeExperimentalTerrainAvailability');
    expectTypeOf<typeof royalLensSchema>().not.toHaveProperty('terrainManifests');
    expectTypeOf<RoyalLensStores>().not.toHaveProperty('terrainStore');
  });

  it('keeps v1 wired to the stable internal core instead of the experimental prototype module', () => {
    const v1Source = readFileSync(fileURLToPath(new URL('./v1.ts', import.meta.url)), 'utf8');

    expect(v1Source).toContain("from './stable.js'");
    expect(v1Source).not.toContain("from './index.js'");
  });
});

function createStores(): TestStores {
  const documentState: RoyalDocumentState = {
    scopeId: 'v1',
    root: {
      label: 'root',
      tone: 'surface',
      children: [
        {
          id: 'button',
          label: 'Open fullscreen',
          primitive: 'button',
          tone: 'accent'
        }
      ]
    }
  };
  const layoutState: RoyalLayoutRuntimeState = {
    scopeId: 'v1',
    compact: false,
    grid: { columns: 12, rows: 8 },
    boxes: [
      {
        id: 'button',
        x: 1,
        y: 1,
        width: 6,
        height: 2,
        interaction: {
          label: 'Open fullscreen',
          role: 'button'
        },
        label: 'Open fullscreen',
        primitive: 'button',
        tone: 'accent'
      }
    ],
    pickTargets: [
      {
        id: 'button',
        bounds: {
          rect: { x: 1, y: 1, width: 6, height: 2 },
          space: 'grid'
        },
        interaction: {
          label: 'Open fullscreen',
          role: 'button'
        },
        kind: 'box',
        label: 'Open fullscreen',
        layer: 1
      }
    ]
  };
  const interactionState: RoyalInteractionState = {
    scopeId: 'v1',
    activeId: undefined,
    activationCount: 0,
    focusedId: 'button',
    geometryFailures: [],
    geometryStatus: 'ready',
    hoveredId: 'button',
    pointerSamples: []
  };
  const capabilityState: CapabilityRuntimeState = {
    scopeId: 'v1',
    diagnostics: [],
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
    results: []
  };
  return {
    capabilityStore: writableStore(capabilityState),
    documentStore: writableStore(documentState),
    interactionStore: writableStore(interactionState),
    layoutStore: writableStore(layoutState)
  };
}

function writableStore<State>(initialState: State): RoyalWritableStore<State> {
  let state = initialState;

  return {
    getState: () => state,
    setState: (updater) => {
      state = typeof updater === 'function' ? (updater as (previous: State) => State)(state) : updater;
    }
  };
}
