import {
  Canvas,
} from '@royal/react';
import {
  boxGeometry,
  directionalLight,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  type EulerRads,
  type RenderRoot,
} from '@royal/renderer-core';
import { useState, type PointerEvent, type ReactNode } from 'react';

const cube = boxGeometry({ size: [1, 1, 1] });
const blue = standardMaterial({ color: [0.1, 0.4, 0.88, 1] });
const green = standardMaterial({ color: [0.13, 0.58, 0.34, 1] });
const amber = standardMaterial({ color: [0.92, 0.55, 0.12, 1] });
const rootOptions = {
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const multiObjectScene = (
  rotation: EulerRads,
  scale: number,
): RenderRoot =>
  scene({
    children: [
      pass({
        camera: perspectiveCamera({
          position: [0, 0.5, 6.5],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 1000,
        }),
        children: [
          directionalLight({ direction: [1, -1.8, -1], color: [1, 1, 1, 1] }),
          mesh({
            geometry: cube,
            material: blue,
            transform: {
              position: [-1.45, 0.15, 0],
              rotation,
              scale: [scale, scale, scale],
            },
          }),
          mesh({
            geometry: cube,
            material: green,
            transform: {
              position: [0.2, -0.25, -0.45],
              rotation: [rotation[0] * 0.4, rotation[1] * 0.8, 0.2],
              scale: [0.8, 1.3, 0.8],
            },
          }),
          mesh({
            geometry: cube,
            material: amber,
            transform: {
              position: [1.55, 0.35, 0.15],
              rotation: [0.15, rotation[1] * -0.75, rotation[2]],
              scale: [0.7, 0.7, 0.7],
            },
          }),
        ],
      }),
    ],
  });

export const InteractionLab = (): ReactNode => {
  const [rotation, setRotation] = useState<EulerRads>([0.35, 0.7, 0]);
  const [scale, setScale] = useState(1);

  const rotate = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.buttons !== 1) {
      return;
    }

    setRotation(([x, y, z]) => [
      x + event.movementY / 120,
      y + event.movementX / 120,
      z,
    ]);
  };

  return (
    <div className="stacked-demo">
      <div className="canvas-slot">
        <Canvas
          aria-label="Interactive multi object scene"
          rootOptions={rootOptions}
          onPointerMove={rotate}
        >
          {multiObjectScene(rotation, scale)}
        </Canvas>
      </div>
      <div className="control-strip" aria-label="Scene controls">
        <label>
          Scale
          <input
            max="1.4"
            min="0.7"
            step="0.05"
            type="range"
            value={scale}
            onChange={(event) => setScale(Number(event.currentTarget.value))}
          />
        </label>
        <button
          type="button"
          onClick={() => setRotation(([x, y, z]) => [x, y + Math.PI / 8, z])}
        >
          Rotate
        </button>
      </div>
    </div>
  );
};
