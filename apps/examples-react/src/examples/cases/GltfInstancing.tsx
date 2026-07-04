import {
  Canvas,
  OrbitControls,
  useFrame,
  useOrbitCamera,
  type RenderObjectHandle,
} from '@royal/react';
import { studioEnvironment } from '@royal/renderer-core';
import { createElement, Fragment, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRenderer } from '../example-renderer';

const fixtureBase = import.meta.env.BASE_URL + 'fixtures/gltf-instancing/';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.65,
  specularIntensity: 1.35,
});
const cubeSources = [
  fixtureBase + 'instanced-cube-a.gltf',
  fixtureBase + 'instanced-cube-b.gltf',
  fixtureBase + 'instanced-cube-c.gltf',
] as const;

const spacing = 0.34;
const defaultGridSize = 16;
const maxBenchmarkGridSize = 28;

type CubeInstance = {
  readonly phase: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly src: string;
};

type InstancingConfig = {
  readonly animate: boolean;
  readonly gridSize: number;
  readonly seed: number;
};

const finiteIntegerParam = (
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const instancingConfigFromLocation = (): InstancingConfig => {
  const params = new URL(globalThis.location.href).searchParams;
  const animate = params.get('animate') !== '0';
  return {
    animate,
    gridSize: finiteIntegerParam(params, 'grid', defaultGridSize, 1, maxBenchmarkGridSize),
    seed: finiteIntegerParam(params, 'seed', 0, 0, 0xffff_ffff),
  };
};

const createCubeInstances = ({ gridSize, seed }: InstancingConfig): readonly CubeInstance[] =>
  Array.from({ length: gridSize ** 3 }, (_, index): CubeInstance => {
    const x = index % gridSize;
    const y = Math.floor(index / gridSize) % gridSize;
    const z = Math.floor(index / (gridSize * gridSize));
    const centeredX = (x - (gridSize - 1) / 2) * spacing;
    const centeredY = (y - (gridSize - 1) / 2) * spacing;
    const centeredZ = (z - (gridSize - 1) / 2) * spacing;
    const size = 0.105 + ((x + y + z + seed) % 4) * 0.006;

    return {
      phase: x * 0.36 + y * 0.24 + z * 0.18 + seed * 0.0001,
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
      src: cubeSources[(index + seed) % cubeSources.length]!,
    };
  });

type InstanceHandleRef = MutableRefObject<RenderObjectHandle | null>;

const InstancedCubeAnimation = ({
  cubeInstances,
  refs,
}: {
  readonly cubeInstances: readonly CubeInstance[];
  readonly refs: readonly InstanceHandleRef[];
}): null => {
  useFrame(({ elapsed }) => {
    const pulse = elapsed * 1.65;

    // Animation mutates renderer handles to avoid reconciling thousands of model elements per frame.
    for (const [index, instance] of cubeInstances.entries()) {
      const handle = refs[index]?.current;
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

  return null;
};

const cubeKey = (instance: CubeInstance): string =>
  `${instance.src}:${instance.position.join(',')}`;

const StaticInstancedCubeField = ({
  cubeInstances,
}: {
  readonly cubeInstances: readonly CubeInstance[];
}): ReactNode => (
  <>
    {cubeInstances.map((instance) =>
      createElement(
        Fragment,
        { key: cubeKey(instance) },
        <model
          src={instance.src}
          transform={{
            position: instance.position,
            rotation: instance.rotation,
            scale: instance.scale,
          }}
        />
      )
    )}
  </>
);

const AnimatedInstancedCubeField = ({
  cubeInstances,
}: {
  readonly cubeInstances: readonly CubeInstance[];
}): ReactNode => {
  const refs = useRef(cubeInstances.map(() => ({ current: null as RenderObjectHandle | null })));
  if (refs.current.length !== cubeInstances.length) {
    refs.current = cubeInstances.map(() => ({ current: null as RenderObjectHandle | null }));
  }

  return (
    <>
      <InstancedCubeAnimation cubeInstances={cubeInstances} refs={refs.current} />
      {cubeInstances.map((instance, index) =>
        createElement(
          Fragment,
          { key: cubeKey(instance) },
          <model
            ref={refs.current[index]!}
            src={instance.src}
            transform={{
              position: instance.position,
              rotation: instance.rotation,
              scale: instance.scale,
            }}
          />
        )
      )}
    </>
  );
};

export const GltfInstancing = (): ReactNode => {
  const instancingConfig = instancingConfigFromLocation();
  const cubeInstances = useMemo(
    () => createCubeInstances(instancingConfig),
    [instancingConfig.gridSize, instancingConfig.seed],
  );
  const orbit = useOrbitCamera({
    distance: 11,
    pitch: -0.32,
    target: [0, 0, 0],
    yaw: 0.42,
  });

  return (
    <Canvas
      aria-label="glTF automatic instancing"
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment}>
          <directionalLight color={[0.9, 0.86, 0.78, 1]} direction={[0.36, -0.72, -1]} />
          {instancingConfig.animate
            ? <AnimatedInstancedCubeField cubeInstances={cubeInstances} />
            : <StaticInstancedCubeField cubeInstances={cubeInstances} />}
        </pass>
      </scene>
      <BenchmarkRendererSnapshot />
      <OrbitControls {...orbit.controls} maxDistance={24} minDistance={4} />
    </Canvas>
  );
};
