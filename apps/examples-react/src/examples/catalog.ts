import { CapabilityLab } from './cases/CapabilityLab';
import capabilityLabSource from './cases/CapabilityLab.tsx?raw';
import { GltfHelmet } from './cases/GltfHelmet';
import gltfHelmetSource from './cases/GltfHelmet.tsx?raw';
import { HelloCube } from './cases/HelloCube';
import helloCubeSource from './cases/HelloCube.tsx?raw';
import { ImperativeRoot } from './cases/ImperativeRoot';
import imperativeRootSource from './cases/ImperativeRoot.tsx?raw';
import { InteractionLab } from './cases/InteractionLab';
import interactionLabSource from './cases/InteractionLab.tsx?raw';
import { PickingFuzzLab } from './cases/PickingFuzzLab';
import pickingFuzzLabSource from './cases/PickingFuzzLab.tsx?raw';
import { TarstateScene } from './cases/TarstateScene';
import tarstateSceneSource from './cases/TarstateScene.tsx?raw';
import { TextPrototype } from './cases/TextPrototype';
import textPrototypeSource from './cases/TextPrototype.tsx?raw';
import {
  CapabilityRowsProbe,
  PickingRowsProbe,
  RenderRowsProbe,
  TarstateSourceProbe,
} from './probes';
import type {
  ExampleDefinition,
  ExampleSectionDefinition,
} from './types';

const examples = [
  {
    id: 'hello-cube',
    path: '/hello-cube',
    section: 'primary',
    title: 'Hello Cube',
    summary: 'A single Royal canvas with a lit cube and a minimal render graph.',
    Demo: HelloCube,
    source: helloCubeSource,
    sourceFile: 'cases/HelloCube.tsx',
    sourceExport: 'HelloCube',
    probe: RenderRowsProbe,
    notes: [
      'Uses the public React canvas wrapper.',
      'Keeps scene construction small enough to read in one pass.',
    ],
    visualSmoke: {
      surface: 'canvas',
      canvasLabel: 'Lit cube',
      readableText: ['Hello Cube', 'cases/HelloCube.tsx', 'export const HelloCube'],
      minColorBuckets: 5,
      minPaintedRatio: 0.01,
    },
  },
  {
    id: 'imperative-root',
    path: '/imperative-root',
    section: 'primary',
    title: 'Imperative Root',
    summary: 'Creates a Royal root from a canvas ref and renders frames directly.',
    Demo: ImperativeRoot,
    source: imperativeRootSource,
    sourceFile: 'cases/ImperativeRoot.tsx',
    sourceExport: 'ImperativeRoot',
    notes: [
      'Useful for adapters that own the DOM node lifecycle.',
      'The root cleanup path calls dispose.',
    ],
    visualSmoke: {
      surface: 'canvas',
      canvasLabel: 'Imperative Royal root',
      readableText: ['Imperative Root', 'cases/ImperativeRoot.tsx', 'export const ImperativeRoot'],
      minColorBuckets: 5,
      minPaintedRatio: 0.01,
    },
  },
  {
    id: 'gltf-helmet',
    path: '/gltf-helmet',
    section: 'primary',
    title: 'glTF Helmet',
    summary: 'Loads the Damaged Helmet fixture through the Royal glTF node.',
    Demo: GltfHelmet,
    source: gltfHelmetSource,
    sourceFile: 'cases/GltfHelmet.tsx',
    sourceExport: 'GltfHelmet',
    notes: [
      'Uses the app fixture public directory for model assets.',
      'Keeps asset loading in the same render graph shape as other cases.',
    ],
    visualSmoke: {
      surface: 'canvas',
      canvasLabel: 'Damaged Helmet glTF model',
      readableText: ['glTF Helmet', 'cases/GltfHelmet.tsx', 'export const GltfHelmet'],
      minColorBuckets: 8,
      minPaintedRatio: 0.04,
    },
  },
  {
    id: 'interaction-lab',
    path: '/labs/interaction',
    section: 'labs-prototypes',
    title: 'Interaction Lab',
    summary: 'Combines pointer input, simple controls, and renderer state updates.',
    Demo: InteractionLab,
    source: interactionLabSource,
    sourceFile: 'cases/InteractionLab.tsx',
    sourceExport: 'InteractionLab',
    notes: [
      'Drag in the canvas to rotate the scene.',
      'The range control changes cube scale without replacing renderer APIs.',
    ],
    visualSmoke: {
      surface: 'canvas',
      canvasLabel: 'Interactive multi object scene',
      readableText: ['Interaction Lab', 'Scale', 'Rotate', 'export const InteractionLab'],
      minColorBuckets: 8,
      minPaintedRatio: 0.01,
    },
  },
  {
    id: 'tarstate-scene',
    path: '/labs/tarstate-scene',
    section: 'labs-prototypes',
    title: 'Tarstate Scene',
    summary: 'Projects workbench layout state into Tarstate lens rows and render probes.',
    Demo: TarstateScene,
    source: tarstateSceneSource,
    sourceFile: 'cases/TarstateScene.tsx',
    sourceExport: 'TarstateScene',
    probe: TarstateSourceProbe,
    notes: [
      'Uses the current field helpers through the lens schema.',
      'The probe exposes relation counts from the snapshot.',
    ],
    visualSmoke: {
      surface: 'canvas',
      canvasLabel: 'Tarstate workbench scene',
      readableText: ['Tarstate Scene', 'cases/TarstateScene.tsx', 'relation', 'export const TarstateScene'],
      minColorBuckets: 8,
      minPaintedRatio: 0.08,
    },
  },
  {
    id: 'text-prototype',
    path: '/labs/text-prototype',
    section: 'labs-prototypes',
    title: 'Text Prototype',
    summary: 'Shapes vector text, creates mesh data, and renders it in an orthographic pass.',
    Demo: TextPrototype,
    source: textPrototypeSource,
    sourceFile: 'cases/TextPrototype.tsx',
    sourceExport: 'TextPrototype',
    notes: [
      'Text stays in the renderer graph as vector text.',
      'The controls show shaping and mesh metrics for the current label.',
    ],
    visualSmoke: {
      surface: 'canvas',
      canvasLabel: 'Vector text prototype',
      readableText: ['Text Prototype', 'AV office 108%.', 'glyphs', 'vertices', 'export const TextPrototype'],
      minColorBuckets: 8,
      minPaintedRatio: 0.08,
      textQuality: {
        acceptanceText: 'AV office 108%.',
        inputLabel: 'Text label',
        roi: { x: 0.05, y: 0.18, width: 0.78, height: 0.32 },
        warnThresholds: {
          minEdgeTransitions: 80,
          minForegroundPixels: 80,
          minInkCoverage: 0.002,
          minLuminanceBuckets: 2,
        },
      },
    },
  },
  {
    id: 'capability-lab',
    path: '/labs/capability',
    section: 'labs-prototypes',
    title: 'Capability Lab',
    summary: 'Shows capability results and boundary policy data through lens queries.',
    Demo: CapabilityLab,
    source: capabilityLabSource,
    sourceFile: 'cases/CapabilityLab.tsx',
    sourceExport: 'CapabilityLab',
    probe: CapabilityRowsProbe,
    notes: [
      'Browser and renderer handles remain adapter-only.',
      'Rows include queued and diagnostic capability outcomes.',
    ],
    visualSmoke: {
      surface: 'dom',
      readableText: ['Capability Lab', 'relations', 'capability results', 'adapter-only handles', 'export const CapabilityLab'],
    },
  },
  {
    id: 'picking-fuzz-lab',
    path: '/labs/picking-fuzz',
    section: 'labs-prototypes',
    title: 'Picking Fuzz Lab',
    summary: 'Samples pointer positions against layout bounds and displays pick probe rows.',
    Demo: PickingFuzzLab,
    source: pickingFuzzLabSource,
    sourceFile: 'cases/PickingFuzzLab.tsx',
    sourceExport: 'PickingFuzzLab',
    probe: PickingRowsProbe,
    notes: [
      'The live stage maps pointer coordinates into grid space.',
      'Probe rows join samples to pick target labels.',
    ],
    visualSmoke: {
      surface: 'dom',
      readableText: ['Picking Fuzz Lab', 'Viewport', 'sampleId', 'targetLabel', 'export const PickingFuzzLab'],
    },
  },
] as const satisfies readonly ExampleDefinition[];

const sections = [
  {
    id: 'primary',
    title: 'Examples',
  },
  {
    id: 'labs-prototypes',
    title: 'Labs/Prototypes',
  },
] as const;

export const exampleSections = sections.map((section) => ({
  ...section,
  examples: examples.filter((example) => example.section === section.id),
})) satisfies readonly ExampleSectionDefinition[];

export const exampleCatalog = examples;
export const firstExample = examples[0];

export const exampleById = (id: string): ExampleDefinition | undefined =>
  examples.find((example) => example.id === id);
