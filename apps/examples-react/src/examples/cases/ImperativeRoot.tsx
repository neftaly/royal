import {
  createRoot,
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
import { useLayoutEffect, useRef, type ReactNode } from 'react';

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [0.85, 0.16, 0.18, 1] });
const rootOptions = { alpha: true, antialias: true, preserveDrawingBuffer: true } as const;

const cubeScene = (rotation: EulerRads): RenderRoot =>
  scene({
    children: [
      pass({
        camera: perspectiveCamera({
          position: [0, 0, 5],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 1000,
        }),
        children: [
          directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] }),
          mesh({
            geometry: cube,
            material: red,
            transform: {
              position: [0, 0, 0],
              rotation,
            },
          }),
        ],
      }),
    ],
  });

export const ImperativeRoot = (): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }

    const root = createRoot(canvas, rootOptions);
    let frameId = 0;
    let disposed = false;

    const renderFrame = (time: number): void => {
      if (disposed) {
        return;
      }

      const phase = time / 1100;
      root.render(cubeScene([0.45 + Math.sin(phase) * 0.25, phase, 0.1]));
      frameId = window.requestAnimationFrame(renderFrame);
    };

    frameId = window.requestAnimationFrame(renderFrame);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      root.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Imperative Royal root" />;
};
