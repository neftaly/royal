import type {
  CapabilityRuntimeState,
  RoyalDocumentState,
  RoyalInteractionState,
  RoyalLayoutRuntimeState,
  RoyalLensStores,
  RoyalReadableStore,
} from '@royal/tarstate-lens/v1';
import type {
  RoyalLayoutBoxInput,
  RoyalLayoutSpecInput,
  RoyalPickTargetInput,
  RoyalPointerSampleInput,
} from '@royal/tarstate-lens';

export const workbenchScopeId = 'examples-workbench';

export const layoutBoxes: readonly RoyalLayoutBoxInput[] = [
  {
    id: 'viewport',
    x: 0,
    y: 0,
    width: 8,
    height: 5,
    label: 'Viewport',
    primitive: 'panel',
    tone: 'neutral',
    text: 'Canvas host',
    interaction: {
      label: 'Select viewport',
      role: 'region',
    },
  },
  {
    id: 'cube-control',
    x: 8,
    y: 0,
    width: 4,
    height: 2,
    label: 'Cube Control',
    primitive: 'button',
    tone: 'accent',
    interaction: {
      label: 'Toggle cube',
      role: 'button',
      group: 'controls',
    },
  },
  {
    id: 'probe-readout',
    x: 8,
    y: 2,
    width: 4,
    height: 3,
    label: 'Probe Readout',
    primitive: 'panel',
    tone: 'info',
    text: 'Rows and diagnostics',
  },
];

export const pickTargets: readonly RoyalPickTargetInput[] = layoutBoxes.flatMap((box, index) => {
  if (box.interaction === undefined) {
    return [];
  }

  return [{
    id: box.id,
    kind: box.primitive,
    label: box.label,
    layer: index,
    bounds: {
      rect: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      space: 'grid',
    },
    interaction: box.interaction,
  }];
});

export const layoutState: RoyalLayoutRuntimeState = {
  scopeId: workbenchScopeId,
  compact: false,
  grid: {
    columns: 12,
    rows: 5,
  },
  boxes: layoutBoxes,
  pickTargets,
};

const documentRoot: RoyalLayoutSpecInput = {
  label: 'Examples Workbench',
  primitive: 'root',
  tone: 'neutral',
  children: layoutBoxes.map((box) => ({
    id: box.id,
    objectId: box.id,
    label: box.label,
    primitive: box.primitive,
    tone: box.tone,
    ...(box.text === undefined ? {} : { text: box.text }),
    ...(box.interaction === undefined ? {} : { interaction: box.interaction }),
  })),
};

export const documentState: RoyalDocumentState = {
  scopeId: workbenchScopeId,
  root: documentRoot,
};

export const interactionState: RoyalInteractionState = {
  scopeId: workbenchScopeId,
  activeId: 'cube-control',
  activationCount: 4,
  focusedId: 'cube-control',
  hoveredId: 'viewport',
  geometryFailures: [],
  geometryStatus: 'ready',
  pointerSamples: [
    {
      sampleId: 'sample-1',
      sequence: 1,
      kind: 'move',
      x: 2.5,
      y: 1.5,
      targetId: 'viewport',
    },
    {
      sampleId: 'sample-2',
      sequence: 2,
      kind: 'down',
      x: 9.25,
      y: 0.75,
      targetId: 'cube-control',
    },
  ],
};

export const capabilityState: CapabilityRuntimeState = {
  scopeId: workbenchScopeId,
  intents: [
    {
      intentId: 'intent-1',
      capabilityId: 'webgl-context',
      kind: 'probe',
      resourceId: 'canvas',
      payloadKind: 'capability-request',
      sequence: 1,
    },
    {
      intentId: 'intent-2',
      capabilityId: 'asset-fetch',
      kind: 'probe',
      resourceId: 'DamagedHelmet',
      payloadKind: 'asset-request',
      sequence: 2,
    },
  ],
  results: [
    {
      resultId: 'result-1',
      intentId: 'intent-1',
      capabilityId: 'webgl-context',
      resourceId: 'canvas',
      status: 'ok',
      message: 'Context available',
      sequence: 1,
    },
    {
      resultId: 'result-2',
      intentId: 'intent-2',
      capabilityId: 'asset-fetch',
      resourceId: 'DamagedHelmet',
      status: 'queued',
      message: 'Asset request is adapter-owned',
      sequence: 2,
    },
  ],
  diagnostics: [
    {
      diagnosticId: 'diag-1',
      code: 'activation_required',
      capabilityId: 'asset-fetch',
      resourceId: 'DamagedHelmet',
      resultId: 'result-2',
      message: 'Asset work waits for an adapter activation boundary',
      sequence: 2,
    },
  ],
};

export const storeOf = <State,>(state: State): RoyalReadableStore<State> => ({
  getState: () => state,
});

export const royalStores = (input: {
  readonly interaction?: RoyalInteractionState;
  readonly capability?: CapabilityRuntimeState;
} = {}): RoyalLensStores => ({
  documentStore: storeOf(documentState),
  layoutStore: storeOf(layoutState),
  interactionStore: storeOf(input.interaction ?? interactionState),
  capabilityStore: storeOf(input.capability ?? capabilityState),
});

export const targetIdAtGridPoint = (
  x: number,
  y: number,
): string | undefined => {
  const orderedTargets = [...pickTargets].sort((a, b) => b.layer - a.layer);

  return orderedTargets.find((target) => {
    const rect = target.bounds.rect;
    return x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height;
  })?.id;
};

export const pointerSample = (
  sequence: number,
  x: number,
  y: number,
  kind: RoyalPointerSampleInput['kind'] = 'move',
): RoyalPointerSampleInput => ({
  sampleId: `sample-live-${sequence}`,
  sequence,
  kind,
  x,
  y,
  targetId: targetIdAtGridPoint(x, y),
});
