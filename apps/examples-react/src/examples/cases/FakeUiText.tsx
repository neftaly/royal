/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  unlitMaterial,
  type Material,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type Vec3,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

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
    (
      <mesh
        geometry={panelGeometry}
        material={material(color)}
        transform={{ position, rotation: [0, 0, 0], scale: size }}
      />
    ) as RenderNode,
    (
      <text
        color={[0.94, 0.96, 0.98, 1]}
        fontSize={0.26}
        lineHeight={0.34}
        origin={labelOrigin}
        text={label}
      />
    ) as RenderNode,
  ];
};

const fakeUiScene = (): RenderRoot => (
  <scene>
    <pass clearColor={[0.05, 0.06, 0.08, 1]}>
      <orthographicCamera
        bottom={-3}
        far={100}
        left={-4}
        near={0.1}
        position={[0, 0, 8]}
        right={4}
        rotation={[0, 0, 0]}
        top={3}
      />
      {layoutBoxes.flatMap(panel)}
      <text
        color={[0.58, 0.82, 0.95, 1]}
        fontSize={0.2}
        lineHeight={0.3}
        origin={[-3.18, 0.36, 0.1]}
        text="Camera / Key Light / Helmet"
      />
      <text
        color={[0.95, 0.78, 0.42, 1]}
        fontSize={0.2}
        lineHeight={0.3}
        origin={[1.94, -0.78, 0.1]}
        text={'Transform\nMaterial\nBounds'}
      />
    </pass>
  </scene>
) as RenderRoot;

export const FakeUiText = (): ReactNode =>
  createElement(
    'div',
    { className: 'stacked-demo' },
    createElement(
      'div',
      { className: 'canvas-slot' },
      createElement(Canvas, { 'aria-label': 'Fake UI with renderer text', rootOptions }, fakeUiScene()),
    ),
    createElement(
      'div',
      { className: 'control-strip' },
      createElement(
        'label',
        null,
        'Zoom',
        createElement('input', {
          'aria-label': 'Zoom',
          defaultValue: '100',
          disabled: true,
          max: '160',
          min: '60',
          type: 'range',
        }),
      ),
    ),
  );
