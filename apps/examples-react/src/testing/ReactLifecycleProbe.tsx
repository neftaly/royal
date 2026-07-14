import {
  Canvas,
  useFrame,
  useInvalidate,
} from '@royal/react';
import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  solidTexture,
  unlitMaterial,
  virtualTexture,
} from '@royal/react/scene';
import { useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../examples/BenchmarkRendererSnapshot';

const fixtureRoot = import.meta.env.BASE_URL + 'fixtures/virtual-texture-stress/';
const camera = perspectiveCamera({
  far: 20,
  fovY: Math.PI / 4,
  near: 0.01,
  position: [0, 0, 4],
});
const ordinaryScene = scene({
  camera,
  nodes: [mesh({
    geometry: boxGeometry([1.5, 1.5, 1.5]),
    material: unlitMaterial({ texture: solidTexture({ color: [0.2, 0.55, 0.95, 1] }) }),
  })],
});
const virtualTextureScene = scene({
  camera,
  nodes: [mesh({
    geometry: planeGeometry([3, 3]),
    material: unlitMaterial({
      texture: virtualTexture({ manifestUri: `${fixtureRoot}map.vt.json` }),
    }),
  })],
});

const ActiveFrameProbe = (): ReactNode => {
  const invalidate = useInvalidate();
  useFrame(invalidate);
  return null;
};

/** Query-only browser fixture; deliberately absent from example routes and package exports. */
export const ReactLifecycleProbe = (): ReactNode => {
  const [antialias, setAntialias] = useState(true);
  const [mode, setMode] = useState<'animate' | 'ordinary' | 'virtual-texture'>('ordinary');
  const [mounted, setMounted] = useState(true);

  return (
    <main
      data-antialias={String(antialias)}
      data-mode={mode}
      data-react-lifecycle-probe=""
    >
      <button data-probe-action="toggle-antialias" onClick={() => setAntialias((value) => !value)} type="button">
        Toggle antialias
      </button>
      <button data-probe-action="animate" onClick={() => setMode('animate')} type="button">
        Animate
      </button>
      <button data-probe-action="virtual-texture" onClick={() => setMode('virtual-texture')} type="button">
        Virtual texture
      </button>
      <button data-probe-action="toggle-mount" onClick={() => setMounted((value) => !value)} type="button">
        Toggle mount
      </button>
      {mounted ? (
        <Canvas
          aria-label="React renderer lifecycle probe"
          height={320}
          rendererOptions={{ antialias }}
          scene={mode === 'virtual-texture' ? virtualTextureScene : ordinaryScene}
          width={480}
        >
          <BenchmarkRendererSnapshot />
          {mode === 'animate' ? <ActiveFrameProbe /> : null}
        </Canvas>
      ) : <output data-probe-unmounted="">Canvas unmounted</output>}
    </main>
  );
};
