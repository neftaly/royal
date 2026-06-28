import {
  boxGeometry,
  mesh,
  orthographicCamera,
  pass,
  scene,
  text,
  unlitMaterial,
  type Material,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type Vec3,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import type { ReactNode } from 'react';

type LayoutBox = {
  readonly color: Rgba;
  readonly label: string;
  readonly position: Vec3;
  readonly size: Vec3;
};

const panelGeometry = boxGeometry({ size: [1, 1, 0.06] });
const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

// This is the flat layout data a Yoga pass should eventually produce.
// Yoga is not exposed to the examples app yet, so the zoom control is visible but inert.
const layoutBoxes: readonly LayoutBox[] = [
  {
    color: [0.08, 0.1, 0.13, 1],
    label: 'Scene Editor',
    position: [0, 2.2, 0],
    size: [6.9, 0.74, 1],
  },
  {
    color: [0.13, 0.22, 0.28, 1],
    label: 'Viewport',
    position: [-1.15, 0.2, 0],
    size: [4.55, 3.15, 1],
  },
  {
    color: [0.16, 0.18, 0.21, 1],
    label: 'Layers',
    position: [2.65, 0.98, 0],
    size: [1.95, 1.55, 1],
  },
  {
    color: [0.19, 0.17, 0.13, 1],
    label: 'Inspector',
    position: [2.65, -0.98, 0],
    size: [1.95, 1.88, 1],
  },
];

const material = (color: Rgba): Material => unlitMaterial({ color });

const panel = ({ color, label, position, size }: LayoutBox): readonly RenderNode[] => {
  const labelOrigin: Vec3 = [
    position[0] - size[0] / 2 + 0.22,
    position[1] + size[1] / 2 - 0.32,
    0.08,
  ];

  return [
    mesh({
      geometry: panelGeometry,
      material: material(color),
      transform: { position, rotation: [0, 0, 0], scale: size },
    }),
    text({
      color: [0.94, 0.96, 0.98, 1],
      fontSize: 0.26,
      lineHeight: 0.34,
      origin: labelOrigin,
      text: label,
    }),
  ];
};

const fakeUiScene = (): RenderRoot =>
  scene({
    children: [
      pass({
        clearColor: [0.05, 0.06, 0.08, 1],
        camera: orthographicCamera({
          position: [0, 0, 8],
          rotation: [0, 0, 0],
          left: -4,
          right: 4,
          bottom: -3,
          top: 3,
          near: 0.1,
          far: 100,
        }),
        children: [
          ...layoutBoxes.flatMap(panel),
          text({
            color: [0.58, 0.82, 0.95, 1],
            fontSize: 0.2,
            lineHeight: 0.3,
            origin: [-3.18, 0.36, 0.1],
            text: 'Camera / Key Light / Helmet',
          }),
          text({
            color: [0.95, 0.78, 0.42, 1],
            fontSize: 0.2,
            lineHeight: 0.3,
            origin: [1.94, -0.78, 0.1],
            text: 'Transform\nMaterial\nBounds',
          }),
        ],
      }),
    ],
  });

export const FakeUiText = (): ReactNode => (
  <div className="stacked-demo">
    <div className="canvas-slot">
      <Canvas aria-label="Fake UI with renderer text" rootOptions={rootOptions}>
        {fakeUiScene()}
      </Canvas>
    </div>
    <div className="control-strip">
      <label>
        Zoom
        <input aria-label="Zoom" defaultValue="100" disabled max="160" min="60" type="range" />
      </label>
    </div>
  </div>
);
