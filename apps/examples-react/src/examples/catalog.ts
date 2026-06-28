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
    probe: RenderRowsProbe,
    notes: [
      'Uses the public React canvas wrapper.',
      'Keeps scene construction small enough to read in one pass.',
    ],
  },
  {
    id: 'imperative-root',
    path: '/imperative-root',
    section: 'primary',
    title: 'Imperative Root',
    summary: 'Creates a Royal root from a canvas ref and renders frames directly.',
    Demo: ImperativeRoot,
    source: imperativeRootSource,
    notes: [
      'Useful for adapters that own the DOM node lifecycle.',
      'The root cleanup path calls dispose.',
    ],
  },
  {
    id: 'gltf-helmet',
    path: '/gltf-helmet',
    section: 'primary',
    title: 'glTF Helmet',
    summary: 'Loads the Damaged Helmet fixture through the Royal glTF node.',
    Demo: GltfHelmet,
    source: gltfHelmetSource,
    notes: [
      'Uses the app fixture public directory for model assets.',
      'Keeps asset loading in the same render graph shape as other cases.',
    ],
  },
  {
    id: 'interaction-lab',
    path: '/labs/interaction',
    section: 'labs-prototypes',
    title: 'Interaction Lab',
    summary: 'Combines pointer input, simple controls, and renderer state updates.',
    Demo: InteractionLab,
    source: interactionLabSource,
    notes: [
      'Drag in the canvas to rotate the scene.',
      'The range control changes cube scale without replacing renderer APIs.',
    ],
  },
  {
    id: 'tarstate-scene',
    path: '/labs/tarstate-scene',
    section: 'labs-prototypes',
    title: 'Tarstate Scene',
    summary: 'Projects workbench layout state into Tarstate lens rows and render probes.',
    Demo: TarstateScene,
    source: tarstateSceneSource,
    probe: TarstateSourceProbe,
    notes: [
      'Uses the current field helpers through the lens schema.',
      'The probe exposes relation counts from the snapshot.',
    ],
  },
  {
    id: 'text-prototype',
    path: '/labs/text-prototype',
    section: 'labs-prototypes',
    title: 'Text Prototype',
    summary: 'Shapes vector text, creates mesh data, and renders it in an orthographic pass.',
    Demo: TextPrototype,
    source: textPrototypeSource,
    notes: [
      'Text stays in the renderer graph as vector text.',
      'The controls show shaping and mesh metrics for the current label.',
    ],
  },
  {
    id: 'capability-lab',
    path: '/labs/capability',
    section: 'labs-prototypes',
    title: 'Capability Lab',
    summary: 'Shows capability results and boundary policy data through lens queries.',
    Demo: CapabilityLab,
    source: capabilityLabSource,
    probe: CapabilityRowsProbe,
    notes: [
      'Browser and renderer handles remain adapter-only.',
      'Rows include queued and diagnostic capability outcomes.',
    ],
  },
  {
    id: 'picking-fuzz-lab',
    path: '/labs/picking-fuzz',
    section: 'labs-prototypes',
    title: 'Picking Fuzz Lab',
    summary: 'Samples pointer positions against layout bounds and displays pick probe rows.',
    Demo: PickingFuzzLab,
    source: pickingFuzzLabSource,
    probe: PickingRowsProbe,
    notes: [
      'The live stage maps pointer coordinates into grid space.',
      'Probe rows join samples to pick target labels.',
    ],
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
