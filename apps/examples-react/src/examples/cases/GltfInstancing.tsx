/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useFrame,
  useOrbitCamera,
  type RenderObjectHandle,
} from '@royal/react';
import { useRef, type ReactNode } from 'react';
import { exampleRenderer } from '../rendering';

const fixtureBase = import.meta.env.BASE_URL + 'fixtures/gltf-instancing/';
const extensionInstancingSrc = fixtureBase + 'ext-mesh-gpu-instancing-cube.gltf';
const cubeSources = [
  fixtureBase + 'instanced-cube-a.gltf',
  fixtureBase + 'instanced-cube-b.gltf',
  fixtureBase + 'instanced-cube-c.gltf',
] as const;

const gridSize = 16;
const spacing = 0.34;
const cubeInstances = Array.from({ length: gridSize ** 3 }, (_, index) => {
  const x = index % gridSize;
  const y = Math.floor(index / gridSize) % gridSize;
  const z = Math.floor(index / (gridSize * gridSize));
  const centeredX = (x - (gridSize - 1) / 2) * spacing;
  const centeredY = (y - (gridSize - 1) / 2) * spacing;
  const centeredZ = (z - (gridSize - 1) / 2) * spacing;
  const size = 0.105 + ((x + y + z) % 4) * 0.006;

  return {
    phase: x * 0.36 + y * 0.24 + z * 0.18,
    position: [
      centeredX,
      centeredY,
      centeredZ,
    ] as const,
    rotation: [
      0.08 + y * 0.012,
      x * 0.03,
      z * 0.022,
    ] as const,
    scale: [size, size, size] as const,
    src: cubeSources[index % cubeSources.length]!,
  };
});

const InstancedCubeField = (): ReactNode => {
  const refs = useRef(cubeInstances.map(() => ({ current: null as RenderObjectHandle | null })));

  useFrame(({ elapsed }) => {
    const pulse = elapsed * 1.65;

    for (const [index, instance] of cubeInstances.entries()) {
      const handle = refs.current[index]?.current;
      if (handle === null || handle === undefined) continue;

      const lift = Math.sin(pulse + instance.phase) * 0.18;
      const sway = Math.cos(pulse * 0.62 + instance.phase) * 0.045;
      handle.setTransform({
        position: [
          instance.position[0] + sway,
          instance.position[1] + lift,
          instance.position[2],
        ],
        rotation: [
          instance.rotation[0] + sway,
          instance.rotation[1] + elapsed * 0.18,
          instance.rotation[2] + lift * 0.32,
        ],
      });
    }
  });

  return (
    <>
      {cubeInstances.map((instance, index) => (
        <model
          ref={refs.current[index]!}
          src={instance.src}
          transform={{
            position: instance.position,
            rotation: instance.rotation,
            scale: instance.scale,
          }}
        />
      ))}
    </>
  );
};

export const GltfInstancing = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 11,
    pitch: -0.32,
    target: [0, 0, 0],
    yaw: 0.42,
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
          <InstancedCubeField />
          <model
            src={extensionInstancingSrc}
            transform={{
              position: [0, -2.9, 0],
              rotation: [0.1, 0.45, 0],
              scale: [0.16, 0.16, 0.16],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} maxDistance={24} minDistance={4} />
    </Canvas>
  );
};
