import {
  CapabilityProbeDemo,
  CapabilityRowsProbe,
  HelloCubeDemo,
  ImperativeRootDemo,
  InteractiveSceneDemo,
  PickingFuzzShapeDemo,
  PickingRowsProbe,
  RenderRowsProbe,
  TarstateSceneSourceDemo,
  TarstateSourceProbe,
  TextLayoutDemo,
  TextLayoutProbe,
} from './demos/Demos';
import type {
  ExampleDefinition,
  ExampleSectionDefinition,
} from './types';

const helloCubeSource = `import { Canvas, boxGeometry, standardMaterial } from '@royal/react';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [0.85, 0.16, 0.18, 1] });

export function HelloCube() {
  return (
    <Canvas>
      <scene>
        <pass>
          <perspectiveCamera position={[0, 0, 5]} rotation={[0, 0, 0]} fovY={Math.PI / 4} near={0.1} far={1000} />
          <directionalLight direction={[1, -2, -1]} color={[1, 1, 1, 1]} />
          <mesh geometry={cube} material={red} transform={{ position: [0, 0, 0], rotation: [0.4, 0.65, 0] }} />
        </pass>
      </scene>
    </Canvas>
  );
}`;

const imperativeRootSource = `import { createRoot, boxGeometry, mesh, scene, pass } from '@royal/react';

const root = createRoot(canvas);

root.render(scene({
  children: [
    pass({
      camera,
      children: [
        light,
        mesh({ geometry: boxGeometry({ size: [1, 1, 1] }), material, transform }),
      ],
    }),
  ],
}));

root.unmount();`;

const interactiveSceneSource = `const [rotation, setRotation] = useState([0.35, 0.7, 0]);
const [scale, setScale] = useState(1);

<Canvas
  onPointerMove={(event) => {
    if (event.buttons !== 1) return;
    setRotation(([x, y, z]) => [x + event.movementY / 120, y + event.movementX / 120, z]);
  }}
>
  {multiObjectScene(rotation, scale)}
</Canvas>`;

const tarstateSource = `const stores = {
  documentStore: storeOf(documentState),
  layoutStore: storeOf(layoutState),
  interactionStore: storeOf(interactionState),
  capabilityStore: storeOf(capabilityState),
};

const snapshot = createRoyalLensSnapshot(stores);
const renderRows = await evaluateRoyalLens(stores, royalQueries.renderRows);

snapshot.probe.rowCount(royalLensSchema.layoutBoxes);
renderRows.rows.map((row) => row.boxId);`;

const textLayoutSource = `const layout = layoutText({
  text: 'Royal layout',
  fontSize: 0.72,
  lineHeight: 0.9,
});

const meshData = textMesh(layout);

<Canvas>
  {textLayoutScene(layout.source)}
</Canvas>`;

const capabilityProbeSource = `const boundary = royalCapabilityBoundaryContract;
const stores = royalStores();
const rows = await evaluateRoyalLens(stores, royalQueries.capabilityResultRows);

boundary.adapterOnly.includes('DOM nodes');
rows.rows.map((row) => [row.capabilityId, row.status, row.diagnosticCode]);`;

const pickingSource = `const sample = pointerSample(sequence, gridX, gridY);
const interaction = {
  ...interactionState,
  hoveredId: sample.targetId,
  pointerSamples: [...previousSamples, sample],
};

const rows = await evaluateRoyalLens(
  royalStores({ interaction }),
  royalQueries.pickProbeRows,
);`;

const examples = [
  {
    id: 'hello-cube',
    path: '/hello-cube',
    section: 'start-here',
    title: 'Hello Cube',
    summary: 'A single Royal canvas with a lit cube and a minimal render graph.',
    Demo: HelloCubeDemo,
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
    section: 'start-here',
    title: 'Imperative Root',
    summary: 'Creates a Royal root from a canvas ref and renders frames directly.',
    Demo: ImperativeRootDemo,
    source: imperativeRootSource,
    notes: [
      'Useful for adapters that own the DOM node lifecycle.',
      'The root cleanup path calls unmount.',
    ],
  },
  {
    id: 'interactive-scene',
    path: '/interactive-scene',
    section: 'vertical-slices',
    title: 'Interactive Scene',
    summary: 'Combines pointer input, simple controls, and renderer state updates.',
    Demo: InteractiveSceneDemo,
    source: interactiveSceneSource,
    notes: [
      'Drag in the canvas to rotate the scene.',
      'The range control changes cube scale without replacing renderer APIs.',
    ],
  },
  {
    id: 'tarstate-scene-source',
    path: '/tarstate-scene-source',
    section: 'vertical-slices',
    title: 'Tarstate Scene Source',
    summary: 'Projects workbench layout state into Tarstate lens rows and render probes.',
    Demo: TarstateSceneSourceDemo,
    source: tarstateSource,
    probe: TarstateSourceProbe,
    notes: [
      'Uses the current field helpers through the lens schema.',
      'The probe exposes relation counts from the snapshot.',
    ],
  },
  {
    id: 'text-layout',
    path: '/text-layout',
    section: 'vertical-slices',
    title: 'Text + Layout',
    summary: 'Shapes vector text, creates mesh data, and renders it in an orthographic pass.',
    Demo: TextLayoutDemo,
    source: textLayoutSource,
    probe: TextLayoutProbe,
    notes: [
      'Text stays in the renderer graph as vector text.',
      'The probe reads shaping and mesh metrics.',
    ],
  },
  {
    id: 'capability-probe',
    path: '/capability-probe',
    section: 'diagnostics',
    title: 'Capability Probe',
    summary: 'Shows capability results and boundary policy data through lens queries.',
    Demo: CapabilityProbeDemo,
    source: capabilityProbeSource,
    probe: CapabilityRowsProbe,
    notes: [
      'Browser and renderer handles remain adapter-only.',
      'Rows include queued and diagnostic capability outcomes.',
    ],
  },
  {
    id: 'picking-fuzz-shape',
    path: '/picking-fuzz-shape',
    section: 'diagnostics',
    title: 'Picking/Fuzz Shape',
    summary: 'Samples pointer positions against layout bounds and displays pick probe rows.',
    Demo: PickingFuzzShapeDemo,
    source: pickingSource,
    probe: PickingRowsProbe,
    notes: [
      'The live stage maps pointer coordinates into grid space.',
      'Probe rows join samples to pick target labels.',
    ],
  },
] as const satisfies readonly ExampleDefinition[];

const sections = [
  {
    id: 'start-here',
    title: 'Start Here',
  },
  {
    id: 'vertical-slices',
    title: 'Vertical Slices',
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
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
