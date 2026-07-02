/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleRenderer } from '../rendering';

const fixtureBase = import.meta.env.BASE_URL + 'fixtures/gltf-instancing/';
const cubeSources = [
  fixtureBase + 'instanced-cube-a.gltf',
  fixtureBase + 'instanced-cube-b.gltf',
  fixtureBase + 'instanced-cube-c.gltf',
] as const;

const cubeInstances = [
  {
    position: [-1.45, 0.74, 0.1],
    rotation: [0.18, -0.24, 0.12],
    scale: [0.62, 0.62, 0.62],
    src: cubeSources[0],
  },
  {
    position: [0, 0.86, -0.12],
    rotation: [0.04, 0.38, -0.08],
    scale: [0.72, 0.72, 0.72],
    src: cubeSources[1],
  },
  {
    position: [1.42, 0.68, 0.08],
    rotation: [0.22, -0.12, 0.2],
    scale: [0.58, 0.58, 0.58],
    src: cubeSources[2],
  },
  {
    position: [-0.78, -0.22, -0.18],
    rotation: [-0.08, 0.46, -0.16],
    scale: [0.82, 0.82, 0.82],
    src: cubeSources[1],
  },
  {
    position: [0.72, -0.2, 0.16],
    rotation: [0.16, -0.52, 0.1],
    scale: [0.82, 0.82, 0.82],
    src: cubeSources[2],
  },
  {
    position: [-1.46, -1.06, 0.06],
    rotation: [0.28, 0.16, -0.18],
    scale: [0.58, 0.58, 0.58],
    src: cubeSources[2],
  },
  {
    position: [-0.05, -1.18, -0.08],
    rotation: [0.08, -0.34, 0.18],
    scale: [0.7, 0.7, 0.7],
    src: cubeSources[0],
  },
  {
    position: [1.36, -1, 0.04],
    rotation: [-0.12, 0.24, -0.1],
    scale: [0.64, 0.64, 0.64],
    src: cubeSources[1],
  },
] as const;

export const GltfInstancing = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 5.2,
    pitch: -0.08,
    target: [0, -0.14, 0],
    yaw: 0.16,
  });

  return (
    <Canvas
      aria-label="glTF automatic instancing"
      renderer={exampleRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} clearColor={[0.035, 0.045, 0.052, 1]}>
          <directionalLight color={[1.12, 1.06, 0.94, 1]} direction={[0.42, -0.66, -1]} />
          {cubeInstances.map((instance) => (
            <model
              src={instance.src}
              transform={{
                position: instance.position,
                rotation: instance.rotation,
                scale: instance.scale,
              }}
            />
          ))}
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} maxDistance={8} minDistance={2.8} />
    </Canvas>
  );
};
