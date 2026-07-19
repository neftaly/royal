import {
  Canvas,
  OrbitControls,
  useInvalidate,
  useOrbitCamera,
} from '@royal/react';
import {
  createGltfInstanceTransforms,
  directionalLight,
  gltfInstances,
  scene,
  type GltfAssetRef,
  type GltfInstanceTransforms,
} from '@royal/react/scene';
import { useMemo, type ReactNode } from 'react';
import { BenchmarkGltfRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { productEnvironment, productFillLight, productKeyLight, productPass } from '../presentation';
import { useAnimationFrame } from '../use-animation-frame';

const fixtureBase = import.meta.env.BASE_URL + 'fixtures/gltf-instancing/';
const cubeSources = [
  fixtureBase + 'instanced-cube-a.gltf',
  fixtureBase + 'instanced-cube-b.gltf',
  fixtureBase + 'instanced-cube-c.gltf',
] as const;
const benchmarkAsset = { src: cubeSources[0] } satisfies GltfAssetRef;

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
  readonly animation: 'pose' | 'position' | 'rotation';
  readonly animate: boolean;
  readonly gridSize: number;
  readonly redraw: boolean;
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
  const requestedAnimation = params.get('animation');
  const animation = requestedAnimation === 'rotation' || requestedAnimation === 'pose'
    ? requestedAnimation
    : 'position';
  return {
    animation,
    animate,
    gridSize: finiteIntegerParam(params, 'grid', defaultGridSize, 1, maxBenchmarkGridSize),
    redraw: params.get('redraw') === '1',
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

type CubeInstanceGroup = {
  readonly cubeInstances: readonly CubeInstance[];
  readonly instances: GltfInstanceTransforms;
  readonly src: string;
};

const createCubeInstanceGroups = (
  cubeInstances: readonly CubeInstance[],
): readonly CubeInstanceGroup[] => cubeSources.flatMap((src): readonly CubeInstanceGroup[] => {
  const grouped = cubeInstances.filter((instance) => instance.src === src);
  if (grouped.length === 0) return [];
  const positions = new Float32Array(grouped.length * 3);
  const rotations = new Float32Array(grouped.length * 3);
  const scales = new Float32Array(grouped.length * 3);
  for (let index = 0; index < grouped.length; index += 1) {
    const instance = grouped[index]!;
    const offset = index * 3;
    positions.set(instance.position, offset);
    rotations.set(instance.rotation, offset);
    scales.set(instance.scale, offset);
  }
  return [{
    cubeInstances: grouped,
    instances: createGltfInstanceTransforms({
      count: grouped.length,
      positions,
      rotations,
      scales,
    }),
    src,
  }];
});

const InstancedCubeAnimation = ({
  animation,
  groups,
}: {
  readonly animation: InstancingConfig['animation'];
  readonly groups: readonly CubeInstanceGroup[];
}): null => {
  useAnimationFrame((elapsedSeconds) => {
    const pulse = elapsedSeconds * 1.65;

    for (const group of groups) {
      const positions = group.instances.positions;
      const rotations = group.instances.rotations;
      for (let index = 0; index < group.cubeInstances.length; index += 1) {
        const instance = group.cubeInstances[index]!;
        const offset = index * 3;
        const lift = Math.sin(pulse + instance.phase) * 0.18;
        const sway = Math.cos(pulse * 0.62 + instance.phase) * 0.045;
        if (animation !== 'rotation') {
          positions[offset] = instance.position[0] + sway;
          positions[offset + 1] = instance.position[1] + lift;
          positions[offset + 2] = instance.position[2];
        }
        if (animation !== 'position') {
          rotations[offset] = instance.rotation[0] + lift;
          rotations[offset + 1] = instance.rotation[1] + sway;
          rotations[offset + 2] = instance.rotation[2];
        }
      }
      if (animation === 'position') group.instances.commitPosition();
      else if (animation === 'rotation') group.instances.commitRotation();
      else group.instances.commitPose();
    }
  });

  return null;
};

const ForcedRedraw = (): null => {
  const invalidate = useInvalidate();
  useAnimationFrame(invalidate);
  return null;
};

export const GltfInstancing = (): ReactNode => {
  const instancingConfig = instancingConfigFromLocation();
  const cubeInstances = useMemo(
    () => createCubeInstances(instancingConfig),
    [instancingConfig.gridSize, instancingConfig.seed],
  );
  const groups = useMemo(() => createCubeInstanceGroups(cubeInstances), [cubeInstances]);
  const orbit = useOrbitCamera({
    initial: { distance: 11, pitch: -0.32, target: [0, 0, 0], yaw: 0.42 },
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    environment: productEnvironment,
    ...productPass,
    nodes: [
      directionalLight(productKeyLight),
      directionalLight(productFillLight),
      ...groups.map((group) => gltfInstances({
        instances: group.instances,
        src: group.src,
      })),
    ],
  }), [groups, orbit.cameraResource]);

  return (
    <Canvas
      aria-label="glTF automatic instancing"
      rendererOptions={exampleCanvasRendererOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
      scene={renderScene}
    >
      <BenchmarkGltfRendererSnapshot asset={benchmarkAsset} />
      {instancingConfig.animate
        ? <InstancedCubeAnimation animation={instancingConfig.animation} groups={groups} />
        : null}
      {!instancingConfig.animate && instancingConfig.redraw ? <ForcedRedraw /> : null}
      <OrbitControls orbit={orbit} maxDistance={24} minDistance={0.1} />
    </Canvas>
  );
};
