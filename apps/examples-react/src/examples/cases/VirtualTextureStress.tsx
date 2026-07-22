import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
  useOrbitCameraView,
  useVirtualTextureAssetStatus,
} from '@royal/react';
import {
  imageTexture,
  mesh,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
} from '@royal/react/scene';
import { useMemo, useState, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRendererOptions } from '../example-renderer-options';
import { transparentViewportClearColor } from '../presentation';
const fixtureRoot = import.meta.env.BASE_URL + 'fixtures/virtual-texture-stress/';
const mapGeometry = planeGeometry([8, 8]);
const mapTexture = virtualTexture({
  sampler: { magFilter: 'nearest', minFilter: 'nearest', wrapS: 'clamp-to-edge', wrapT: 'clamp-to-edge' },
  manifestUri: `${fixtureRoot}map.vt.json`,
});
const mapMaterial = unlitMaterial({
  texture: mapTexture,
});
const residencyMarkerGeometry = planeGeometry([0.24, 0.24]);
const residencyMarkerSrc = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQI12P4z/D/PwAG/gL+93DmpAAAAABJRU5ErkJggg==';
const residencyMarkerMaterial = unlitMaterial({
  texture: imageTexture({
    sampler: { magFilter: 'nearest', minFilter: 'nearest' },
    src: residencyMarkerSrc,
  }),
});

const views = {
  Both: { distance: 11, pitch: 0, target: [0, 0, 0] as const, yaw: 0 },
  NE: { distance: 4.8, pitch: 0, target: [2, 2, 0] as const, yaw: 0 },
  NW: { distance: 4.8, pitch: 0, target: [-2, 2, 0] as const, yaw: 0 },
  SE: { distance: 4.8, pitch: 0, target: [2, -2, 0] as const, yaw: 0 },
  SW: { distance: 4.8, pitch: 0, target: [-2, -2, 0] as const, yaw: 0 },
  Ground: { distance: 6, pitch: 0.65, target: [-2, 0, 2] as const, yaw: 0 },
} as const;

type ViewName = keyof typeof views;
const groundCloseView = { ...views.Ground, distance: 0.1 } as const;

const VirtualTextureStatusLabel = (): ReactNode => {
  const status = useVirtualTextureAssetStatus(mapTexture);
  return (
    <>
      <BenchmarkRendererSnapshot virtualTextureStatus={status} />
      <output className="status" data-vt-status={status.status}>
        {status.status} · {status.residentPages} resident · {status.pendingPages} pending · {status.failedPages} failed
      </output>
    </>
  );
};

export const VirtualTextureStress = (): ReactNode => {
  const groundCloseRequested = new URLSearchParams(globalThis.location.search)
    .get('view') === 'ground-close';
  const orbit = useOrbitCamera({
    initial: groundCloseRequested ? groundCloseView : views.Both,
    far: 80,
    near: 0.01,
  });
  const orbitView = useOrbitCameraView(orbit);
  const [surface, setSurface] = useState<'ground' | 'wall'>(
    groundCloseRequested ? 'ground' : 'wall',
  );
  const ground = surface === 'ground';
  const renderScene = useMemo(() => scene({
    camera: orbit.camera,
    clearColor: transparentViewportClearColor,
    nodes: [
      mesh({
        geometry: mapGeometry,
        material: mapMaterial,
        ...(ground ? { transform: { rotation: [-Math.PI / 2, 0, 0] as const } } : {}),
      }),
      mesh({
        geometry: residencyMarkerGeometry,
        material: residencyMarkerMaterial,
        transform: ground
          ? { position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0] }
          : { position: [0, 0, 0.01] },
      }),
    ],
  }), [ground, orbit.camera]);
  const activeView = (name: ViewName): boolean => {
    const view = views[name];
    return ground === (name === 'Ground')
      && Math.abs(orbitView.target[0] - view.target[0]) < 0.01
      && Math.abs(orbitView.target[1] - view.target[1]) < 0.01
      && Math.abs(orbitView.target[2] - view.target[2]) < 0.01
      && Math.abs(orbitView.distance - view.distance) < 0.01;
  };
  const chooseView = (name: ViewName): void => {
    setSurface(name === 'Ground' ? 'ground' : 'wall');
    orbit.setView(views[name]);
  };

  return (
    <div className="vt-stress">
      <div className="vt-stress-toolbar">
        <div className="vt-stress-summary">
          <img alt="Map orientation reference" height="52" src={`${fixtureRoot}map-overview.svg`} width="52" />
          <div>
            <strong>4096² virtual map · 85 logical pages</strong>
            <span>Use a region preset, then orbit, pan, or zoom across the labeled atlas.</span>
          </div>
        </div>
        <div className="vt-stress-actions" aria-label="Map camera presets" role="group">
          {(['Both', 'NW', 'NE', 'SW', 'SE', 'Ground'] as const).map((name) => (
            <button
              aria-pressed={activeView(name)}
              data-vt-preset={name}
              key={name}
              type="button"
              onClick={() => chooseView(name)}
            >
              {name === 'Both' ? 'Overview' : name === 'Ground' ? 'Ground plane' : name}
            </button>
          ))}
        </div>
      </div>
      <div className="vt-stress-canvas">
        <Canvas
          aria-label="Interactive giant virtual texture map"
          data-map-distance={orbitView.distance.toFixed(3)}
          data-map-target-x={orbitView.target[0].toFixed(3)}
          data-map-target-y={orbitView.target[1].toFixed(3)}
          data-vt-distance={orbitView.distance.toFixed(3)}
          data-vt-surface={surface}
          rendererOptions={exampleCanvasRendererOptions}
          scene={renderScene}
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          <VirtualTextureStatusLabel />
          <OrbitControls
            enablePan
            maxDistance={60}
            minDistance={0.1}
            orbit={orbit}
            zoomSpeed={0.0015}
          />
        </Canvas>
      </div>
    </div>
  );
};
