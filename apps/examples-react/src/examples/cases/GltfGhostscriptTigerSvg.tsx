import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { gltf, scene } from '@royal/react/scene';
import { useMemo, useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';

const tigerCardSrc = import.meta.env.BASE_URL + 'fixtures/gltf-svg-texture/ghostscript-tiger-card.gltf';

export const GltfGhostscriptTigerSvg = (): ReactNode => {
  const [automaticVirtualTextures, setAutomaticVirtualTextures] = useState(true);
  const orbit = useOrbitCamera({
    initial: { distance: 0.72, pitch: 0.08, target: [0, -0.01, 0], yaw: 0.22 },
    far: 10,
    near: 0.001,
  });
  const renderScene = useMemo(() => scene({
    camera: orbit.cameraResource,
    toneMapping: 'linear-clamp',
    nodes: [gltf({
      src: tigerCardSrc,
      transform: {
        position: [0, -0.01, 0],
        rotation: [0, -0.34, 0],
        scale: [1.85, 1.85, 1.85],
      },
    })],
  }), [orbit.cameraResource]);
  const rendererOptions = useMemo(() => ({
    ...exampleCanvasRendererOptions,
    automaticVirtualTextures,
  }), [automaticVirtualTextures]);

  return (
    <div
      className="svg-texture-example"
      data-svg-texture-mode={automaticVirtualTextures ? 'virtual' : 'ordinary'}
    >
      <Canvas
        aria-label="glTF core SVG Ghostscript tiger card fixture"
        rendererOptions={rendererOptions}
        style={{ cursor: 'grab', touchAction: 'none' }}
        scene={renderScene}
      >
        <BenchmarkRendererSnapshot />
        <OrbitControls orbit={orbit} maxDistance={2.5} minDistance={0.02} />
      </Canvas>
      <button
        aria-label={`Switch to ${automaticVirtualTextures ? 'ordinary' : 'generated virtual'} SVG texture`}
        aria-pressed={automaticVirtualTextures}
        className="svg-texture-mode"
        type="button"
        onClick={() => setAutomaticVirtualTextures((enabled) => !enabled)}
      >
        Texture: {automaticVirtualTextures ? 'generated VT' : 'ordinary'}
      </button>
    </div>
  );
};
