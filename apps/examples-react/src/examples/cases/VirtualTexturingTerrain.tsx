import {
  mesh,
  pass,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
} from '@royal/renderer-core';
import {
  orbitPerspectiveCamera,
  type OrbitCameraView,
} from '@royal/react';
import {
  createWebGlRoot,
  type WebGlRoot,
} from '@royal/renderer-webgl';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';

declare global {
  interface Window {
    __royalVirtualTexturingProbe?: {
      readonly active: boolean;
      readonly capabilityPath: 'blocked' | 'fixed-low-mip' | 'live';
      readonly diagnosticsVisible: boolean;
      readonly frame: number;
      readonly manifestUri: string;
      readonly reason?: string;
      readonly routeRegistered: boolean;
      readonly stats?: VirtualTexturingStats;
    };
  }
}

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const canvasStyle = {
  display: 'block',
  minHeight: '360px',
  touchAction: 'none',
  width: '100%',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 3.9,
  pitch: -0.28,
  target: [0, 0, 0],
  yaw: 0.36,
} satisfies OrbitCameraView;

type VirtualTexturingStats = ReturnType<WebGlRoot['snapshot']>['virtualTexturing'];

const manifestUri = `${import.meta.env.BASE_URL}virtual-texturing/manifest.json`;
const terrainGeometry = planeGeometry([3.2, 3.2]);
const terrainVirtualTexture = virtualTexture({
  colorSpace: 'srgb',
  debugName: 'examples-terrain-vt',
  fallbackColor: [0.1, 0.12, 0.14, 1],
  manifestUri,
  sampler: {
    magFilter: 'linear',
    minFilter: 'linear-mipmap-linear',
    wrapS: 'repeat',
    wrapT: 'repeat',
  },
});
const terrainMaterial = unlitMaterial({ texture: terrainVirtualTexture });

const virtualTexturingScene = scene({
  children: [
    pass({
      camera: orbitPerspectiveCamera({
        far: 100,
        fovY: Math.PI / 4,
        near: 0.1,
        view: defaultCameraView,
      }),
      children: [
        mesh({
          geometry: terrainGeometry,
          material: terrainMaterial,
          transform: {
            position: [0, 0, 0],
            rotation: [-Math.PI / 2.55, 0, 0],
          },
        }),
      ],
      clearColor: [0.035, 0.043, 0.05, 1],
    }),
  ],
});

const capabilityPath = (
  stats: VirtualTexturingStats,
): 'blocked' | 'fixed-low-mip' | 'live' => {
  if (stats.unsupportedDraws > 0 || stats.manifestFailures > 0) return 'blocked';
  if (stats.shaderBinds > 0) return 'live';
  if (stats.uploadedPages > 0 && stats.pageTableUpdates > 0) return 'fixed-low-mip';
  return 'blocked';
};

const publishProbe = (root: WebGlRoot, reason?: string): void => {
  const snapshot = root.snapshot();
  const stats = snapshot.virtualTexturing;
  const path = capabilityPath(stats);

  window.__royalVirtualTexturingProbe = {
    active: path !== 'blocked',
    capabilityPath: path,
    diagnosticsVisible: stats.unsupportedDraws > 0 || stats.manifestFailures > 0,
    frame: snapshot.frame,
    manifestUri,
    ...(reason === undefined || path !== 'blocked' ? {} : { reason }),
    routeRegistered: true,
    stats,
  };
};

export const VirtualTexturingTerrain = (): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    const root = createWebGlRoot(canvas, renderer.context);
    let disposed = false;

    root.render(virtualTexturingScene);
    publishProbe(root, 'waiting for virtual texture manifest and page uploads');

    const tick = (): void => {
      if (disposed) return;
      publishProbe(root, 'waiting for virtual texture manifest and page uploads');
      requestAnimationFrame(tick);
    };
    const frame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      root.dispose();
      delete window.__royalVirtualTexturingProbe;
    };
  }, []);

  return (
    <canvas
      aria-label="Virtual texturing terrain"
      ref={canvasRef}
      style={canvasStyle}
    />
  );
};
