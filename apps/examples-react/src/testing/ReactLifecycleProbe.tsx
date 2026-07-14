import {
  Canvas,
  useFrame,
  useGltfAssetStatus,
  useInvalidate,
  useRendererLifecycle,
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
import { Component, useState, type ReactNode } from 'react';
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

const FailingFrameProbe = (): ReactNode => {
  useFrame(() => {
    throw new Error('React lifecycle probe frame failure');
  });
  return null;
};

const RendererObserverProbe = (): ReactNode => {
  const asset = useGltfAssetStatus('/fixtures/lifecycle-probe-absent.gltf');
  const lifecycle = useRendererLifecycle();
  return (
    <output
      data-probe-asset-state={asset.state}
      data-probe-lifecycle-state={lifecycle.state}
    >
      {lifecycle.state}/{asset.state}
    </output>
  );
};

class ProbeErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly error?: string }
> {
  override state: { readonly error?: string } = {};

  static getDerivedStateFromError(error: unknown): { readonly error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  override render(): ReactNode {
    return this.state.error === undefined
      ? this.props.children
      : <output data-probe-error="">{this.state.error}</output>;
  }
}

/** Query-only browser fixture; deliberately absent from example routes and package exports. */
export const ReactLifecycleProbe = (): ReactNode => {
  const [antialias, setAntialias] = useState(true);
  const [failureEpoch, setFailureEpoch] = useState(0);
  const [failFrame, setFailFrame] = useState(false);
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
      <button data-probe-action="fail-frame" onClick={() => setFailFrame(true)} type="button">
        Fail frame
      </button>
      <button
        data-probe-action="recover"
        onClick={() => {
          setFailFrame(false);
          setFailureEpoch((value) => value + 1);
          setMounted(true);
        }}
        type="button"
      >
        Recover
      </button>
      <ProbeErrorBoundary key={failureEpoch}>
        {mounted ? (
          <Canvas
            aria-label="React renderer lifecycle probe"
            height={320}
            rendererOptions={{ antialias }}
            scene={mode === 'virtual-texture' ? virtualTextureScene : ordinaryScene}
            width={480}
          >
            <BenchmarkRendererSnapshot />
            <RendererObserverProbe />
            {mode === 'animate' ? <ActiveFrameProbe /> : null}
            {failFrame ? <FailingFrameProbe /> : null}
          </Canvas>
        ) : <output data-probe-unmounted="">Canvas unmounted</output>}
      </ProbeErrorBoundary>
    </main>
  );
};
