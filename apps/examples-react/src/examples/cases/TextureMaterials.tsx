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
  distance: 5.2,
  pitch: 0.03,
  target: [0, 0.02, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const swatchGeometry = boxGeometry({ size: [1.72, 1.72, 1.72] });
const helmetAlbedoSrc = import.meta.env.BASE_URL + 'DamagedHelmet/Default_albedo.jpg';

export const TextureMaterials = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });

  return (
    <Canvas
      aria-label="Texture materials"
      renderer={renderer}
      style={orbitCanvasStyle}
    >
      <scene>
        <pass camera={camera} clearColor={[0.035, 0.045, 0.052, 1]}>
          <directionalLight color={[1.35, 1.28, 1.16, 1]} direction={[-0.24, -0.42, -1]} />
          <mesh
            geometry={swatchGeometry}
            texture={helmetAlbedoSrc}
            transform={{
              position: [0, 0.02, 0],
              rotation: [0.24, 0.26, -0.04],
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
