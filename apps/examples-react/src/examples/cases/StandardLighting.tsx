/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  planeGeometry,
  standardMaterial,
  unlitMaterial,
} from '@royal/renderer-core';
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
  distance: 7.2,
  pitch: -0.03,
  target: [0, 0.08, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const panelGeometry = planeGeometry([6.1, 3.2]);
const cubeGeometry = boxGeometry([1.05, 1.05, 1.05]);
const slabGeometry = boxGeometry([1.35, 0.54, 1.35]);
const backdropMaterial = standardMaterial({ color: [0.12, 0.17, 0.2, 1] });
const tealMaterial = standardMaterial({ color: [0.08, 0.74, 0.67, 1] });
const coralMaterial = standardMaterial({ color: [0.94, 0.34, 0.22, 1] });
const unlitMarkerMaterial = unlitMaterial({ color: [0.98, 0.9, 0.32, 1] });

export const StandardLighting = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });

  return (
    <Canvas
      aria-label="Standard material directional lighting"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.035, 0.043, 0.05, 1]}>
          <directionalLight color={[1.28, 1.18, 1.02, 1]} direction={[-0.52, -0.72, -1]} />
          <mesh
            geometry={panelGeometry}
            material={backdropMaterial}
            transform={{
              position: [0, 0, -0.72],
              rotation: [0, 0, 0],
            }}
          />
          <mesh
            geometry={cubeGeometry}
            material={tealMaterial}
            transform={{
              position: [-1.2, 0.2, 0],
              rotation: [0.42, 0.55, 0.05],
            }}
          />
          <mesh
            geometry={slabGeometry}
            material={coralMaterial}
            transform={{
              position: [1.28, -0.12, 0.04],
              rotation: [-0.18, -0.72, 0.18],
            }}
          />
          <mesh
            geometry={planeGeometry([0.8, 0.8])}
            material={unlitMarkerMaterial}
            transform={{
              position: [2.62, 1.1, 0.16],
              rotation: [0, 0, 0.78],
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
