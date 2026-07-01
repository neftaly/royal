/** @jsxImportSource @royal/react */
import { boxGeometry } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  orbitPerspectiveCamera,
  type OrbitCameraView,
} from '@royal/react';
import {
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 5,
  pitch: 0.04,
  target: [0, 0, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const cube = boxGeometry({ size: [1.5, 1.5, 1.5] });

export const HelloCube = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const camera = orbitPerspectiveCamera({
    far: 1000,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });

  return (
    <Canvas
      aria-label="Lit cube"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.06, 0.08, 0.1, 1]}>
          <directionalLight color={[1, 1, 1, 1]} direction={[0.8, -1.8, -1]} />
          <mesh
            color={[0.9, 0.2, 0.16, 1]}
            geometry={cube}
            transform={{
              position: [0, 0, 0],
              rotation: [0.45, 0.7, 0.05],
            }}
          />
        </pass>
      </scene>
      <OrbitControls
        {...orbitOptions}
        defaultView={defaultCameraView}
        onChange={setCameraView}
      />
    </Canvas>
  );
};
