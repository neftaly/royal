/** @jsxImportSource @royal/react */
import {
  type GltfOptions,
  type RenderRoot,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  orbitCameraTransform,
  type OrbitCameraView,
} from '@royal/react';
import { useState, type CSSProperties, type ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const helmetCameraView = {
  distance: 3.4,
  pitch: 0.05,
  target: [0, -0.08, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const helmetTransform = {
  position: [0, -0.08, 0],
  rotation: [0, 0.34, 0],
  scale: [1.1, 1.1, 1.1],
} as const satisfies NonNullable<GltfOptions['transform']>;

export const GltfHelmet = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(helmetCameraView);
  const camera = orbitCameraTransform(cameraView);

  return (
    <Canvas
      aria-label="glTF DamagedHelmet"
      rootOptions={rootOptions}
      style={orbitCanvasStyle}
    >
      {(
        <scene>
          <pass clearColor={[0.04, 0.05, 0.06, 1]}>
            <perspectiveCamera
              far={100}
              fovY={Math.PI / 4}
              near={0.1}
              position={camera.position}
              rotation={camera.rotation}
            />
            <directionalLight color={[1, 0.96, 0.9, 1]} direction={[0.4, -0.75, -1]} />
            <gltf
              src={helmetSrc}
              transform={helmetTransform}
            />
          </pass>
        </scene>
      ) as RenderRoot}
      {(
        <OrbitControls
          {...orbitOptions}
          initialView={helmetCameraView}
          onChange={setCameraView}
        />
      ) as ReactNode}
    </Canvas>
  ) as ReactNode;
};
