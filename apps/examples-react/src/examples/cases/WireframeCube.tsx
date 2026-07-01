/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  type RenderRoot,
  wireframeMaterial,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  orbitCameraTransform,
  useFrame,
  type OrbitCameraView,
} from '@royal/react';
import {
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 6,
  pitch: 0.02,
  target: [0, 0, 0],
  yaw: 0,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  color: [0.38, 0.85, 0.95, 1],
});

export const WireframeCube = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const frame = useFrame();
  const camera = orbitCameraTransform(cameraView);
  const spin = frame * 0.012;

  return (
    <Canvas
      aria-label="Wireframe cube"
      rootOptions={rootOptions}
      style={orbitCanvasStyle}
    >
      {(
        <scene>
          <pass clearColor={[0.04, 0.06, 0.08, 1]}>
            <perspectiveCamera
              far={100}
              fovY={Math.PI / 4}
              near={0.1}
              position={camera.position}
              rotation={camera.rotation}
            />
            <mesh
              geometry={cubeGeometry}
              material={cubeMaterial}
              transform={{
                position: [0, 0, 0],
                rotation: [0.42 + spin * 0.28, 0.7 + spin, 0.12],
              }}
            />
          </pass>
        </scene>
      ) as RenderRoot}
      {(
        <OrbitControls
          {...orbitOptions}
          initialView={defaultCameraView}
          onChange={setCameraView}
        />
      ) as ReactNode}
    </Canvas>
  ) as ReactNode;
};
