import { evaluate, write } from '@tarstate/core';
import { describe, expect, it } from 'vitest';
import {
  createPrototypeRoyalLensSnapshot,
  createPrototypeStorePatchDispatcher,
  prototypeRoyalTerrainAvailabilityPatchRoute,
  prototypeRoyalQueries,
  royalLensSchema,
  type RoyalInteractionState,
  type RoyalLayoutRuntimeState,
  type RoyalTerrainOfflineState,
  type WritableStore
} from './index.js';

describe('prototype Royal offline terrain lens', () => {
  it('keeps offline terrain rows on the experimental prototype surface', async () => {
    const terrainStore = writableStore(createTerrainState());
    const stores = {
      interactionStore: writableStore(createInteractionState()),
      layoutStore: writableStore(createLayoutState()),
      terrainStore
    };
    const before = await evaluate(
      createPrototypeRoyalLensSnapshot(stores).source,
      prototypeRoyalQueries.terrainOfflineAssetRows
    );
    const dispatcher = createPrototypeStorePatchDispatcher([
      prototypeRoyalTerrainAvailabilityPatchRoute(terrainStore)
    ]);

    const result = dispatcher.dispatch([
      write(royalLensSchema.terrainAssetAvailability).upsert({
        scopeId: 'terrain-prototype',
        assetId: 'terrain:asset:root-height',
        available: true,
        status: 'resident',
        quality: 'full',
        qualityRank: 3,
        updatedSequence: 7,
        bytesCached: 4096
      })
    ]);
    const after = await evaluate(
      createPrototypeRoyalLensSnapshot(stores).source,
      prototypeRoyalQueries.terrainOfflineAssetRows
    );

    expect(Object.keys(royalLensSchema)).toEqual(expect.arrayContaining([
      'terrainManifests',
      'terrainTiles',
      'terrainAssets',
      'terrainAssetAvailability'
    ]));
    expect(before.diagnostics).toEqual([]);
    expect(before.rows).toHaveLength(2);
    expect(before.rows[0]).toMatchObject({
      scopeId: 'terrain-prototype',
      manifestId: 'terrain:manifest:alpine',
      tileId: 'terrain:tile:0/0/0',
      assetId: 'terrain:asset:root-height',
      available: false,
      quality: 'preview'
    });
    expect(result).toEqual({ patches: 1, applied: 1, diagnostics: [] });
    expect(terrainStore.getState().availability).toEqual([
      {
        assetId: 'terrain:asset:root-height',
        available: true,
        status: 'resident',
        quality: 'full',
        qualityRank: 3,
        updatedSequence: 7,
        bytesCached: 4096
      }
    ]);
    expect(after.rows[0]).toMatchObject({
      assetId: 'terrain:asset:root-height',
      available: true,
      status: 'resident',
      quality: 'full',
      qualityRank: 3,
      updatedSequence: 7,
      bytesCached: 4096
    });
  });
});

function createLayoutState(): RoyalLayoutRuntimeState {
  return {
    scopeId: 'terrain-prototype',
    compact: false,
    grid: { columns: 1, rows: 1 },
    boxes: [],
    pickTargets: []
  };
}

function createInteractionState(): RoyalInteractionState {
  return {
    scopeId: 'terrain-prototype',
    activeId: undefined,
    activationCount: 0,
    focusedId: undefined,
    geometryFailures: [],
    geometryStatus: 'ready',
    hoveredId: undefined,
    pointerSamples: []
  };
}

function createTerrainState(): RoyalTerrainOfflineState {
  return {
    scopeId: 'terrain-prototype',
    manifests: [
      {
        manifestId: 'terrain:manifest:alpine',
        datasetId: 'terrain:dataset:alpine',
        uri: '/offline/terrain/alpine.manifest.json',
        version: '2026-06-29',
        rootTileId: 'terrain:tile:0/0/0',
        minLod: 0,
        maxLod: 1
      }
    ],
    tiles: [
      {
        tileId: 'terrain:tile:0/0/0',
        manifestId: 'terrain:manifest:alpine',
        lod: 0,
        x: 0,
        y: 0
      },
      {
        tileId: 'terrain:tile:1/0/0',
        manifestId: 'terrain:manifest:alpine',
        parentTileId: 'terrain:tile:0/0/0',
        lod: 1,
        x: 0,
        y: 0
      }
    ],
    assets: [
      {
        assetId: 'terrain:asset:root-height',
        manifestId: 'terrain:manifest:alpine',
        tileId: 'terrain:tile:0/0/0',
        kind: 'heightfield',
        uri: '/offline/terrain/alpine/0/0/0.height.ktx2',
        contentHash: 'sha256-height-root',
        byteLength: 4096
      },
      {
        assetId: 'terrain:asset:child-mesh',
        manifestId: 'terrain:manifest:alpine',
        tileId: 'terrain:tile:1/0/0',
        kind: 'mesh',
        uri: '/offline/terrain/alpine/1/0/0.mesh.glb',
        contentHash: 'sha256-mesh-child',
        byteLength: 8192
      }
    ],
    availability: [
      {
        assetId: 'terrain:asset:root-height',
        available: false,
        status: 'cached-preview',
        quality: 'preview',
        qualityRank: 1,
        updatedSequence: 1,
        bytesCached: 1024
      }
    ]
  };
}

function writableStore<State>(initialState: State): WritableStore<State> {
  let state = initialState;

  return {
    getState: () => state,
    setState: (updater) => {
      state = typeof updater === 'function' ? (updater as (previous: State) => State)(state) : updater;
    }
  };
}
