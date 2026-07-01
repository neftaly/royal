/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  mesh,
  standardMaterial,
  unlitMaterial,
  wireframeMaterial,
  type Material,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  orbitPerspectiveCamera,
  type OrbitCameraView,
} from '@royal/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  addVec3,
  normalizeHorizontal,
  scaleVec3,
  selectRenderScene,
  subtractVec3,
  yawFromForward,
  type ActorRenderState,
  type AwarenessVolumeDebug,
  type RenderFrame,
  type Vec3,
} from './networked-lab';
import { useNetworkedLabSelector } from './networked-lab-react';
import { defaultRapierArenaBoxes } from './rapier-physics';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const canvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 9.4,
  pitch: 0.48,
  target: [0.8, 0.38, 0.35],
  yaw: -0.52,
} satisfies OrbitCameraView;

const unitBox = boxGeometry({ size: [1, 1, 1] });
const groundMaterial = standardMaterial({ color: [0.2, 0.24, 0.22, 1] });
const wallMaterial = standardMaterial({ color: [0.32, 0.37, 0.34, 1] });
const coverMaterial = standardMaterial({ color: [0.43, 0.49, 0.43, 1] });
const localMaterial = standardMaterial({ color: [0.28, 0.78, 0.92, 1] });
const dormantActorMaterial = wireframeMaterial({ color: [0.62, 0.66, 0.7, 1], width: 1 });
const ghostActorMaterial = wireframeMaterial({ color: [0.78, 0.86, 0.94, 1], width: 1 });
const actorMaterials: Readonly<Record<string, Material>> = {
  cold: standardMaterial({ color: [0.34, 0.52, 0.92, 1] }),
  dormant: dormantActorMaterial,
  ghost: ghostActorMaterial,
  hot: standardMaterial({ color: [0.48, 0.9, 0.36, 1] }),
  local: localMaterial,
  warm: standardMaterial({ color: [0.98, 0.7, 0.25, 1] }),
};
const focusMaterial = unlitMaterial({ color: [0.44, 1, 0.38, 0.88] });
const peripheralMaterial = unlitMaterial({ color: [1, 0.72, 0.28, 0.84] });
const ambientMaterial = unlitMaterial({ color: [0.42, 0.62, 1, 0.72] });
const proxyMaterial = wireframeMaterial({ color: [1, 1, 1, 1], width: 1 });
const authorityMaterial = wireframeMaterial({ color: [1, 1, 1, 1], width: 1.2 });

type Segment = {
  readonly end: Vec3;
  readonly material: Material;
  readonly start: Vec3;
  readonly thickness: number;
};

const segmentTransform = (
  start: Vec3,
  end: Vec3,
  thickness: number,
): {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
} => {
  const delta = subtractVec3(end, start);
  const length = Math.max(0.001, Math.hypot(delta[0], delta[1], delta[2]));
  const horizontal = Math.max(0.001, Math.hypot(delta[0], delta[2]));

  return {
    position: addVec3(start, scaleVec3(delta, 0.5)),
    rotation: [
      Math.atan2(delta[1], horizontal),
      -Math.atan2(delta[2], delta[0]),
      0,
    ],
    scale: [length, thickness, thickness],
  };
};

const materialForActor = (actor: ActorRenderState): Material => {
  if (actor.proxy === 'ghost' && actor.band !== 'warm') return ghostActorMaterial;
  return actorMaterials[actor.band] ?? dormantActorMaterial;
};

const materialForVolume = (volume: AwarenessVolumeDebug): Material => {
  if (volume.kind === 'cone') return focusMaterial;
  return volume.band === 'warm' ? peripheralMaterial : ambientMaterial;
};

const materialForArenaBox = (id: string): Material => {
  if (id === 'ground') return groundMaterial;
  if (id.startsWith('cover')) return coverMaterial;
  return wallMaterial;
};

const authorityGap = (actor: ActorRenderState): number =>
  Math.hypot(
    actor.position[0] - actor.authorityPosition[0],
    actor.position[1] - actor.authorityPosition[1],
    actor.position[2] - actor.authorityPosition[2],
  );

const coneSegments = (volume: Extract<AwarenessVolumeDebug, { readonly kind: 'cone' }>): readonly Segment[] => {
  const y = volume.position[1] + 0.08;
  const origin: Vec3 = [volume.position[0], y, volume.position[2]];
  const yaw = Math.atan2(volume.forward[2], volume.forward[0]);
  const material = materialForVolume(volume);
  const edgeDirections = [
    yaw - volume.halfAngle,
    yaw + volume.halfAngle,
  ].map((angle) => [Math.cos(angle), 0, Math.sin(angle)] satisfies Vec3);
  const edgeSegments = edgeDirections.map((direction) => ({
    end: addVec3(origin, scaleVec3(direction, volume.range)),
    material,
    start: origin,
    thickness: 0.035,
  }));
  const arcSteps = 14;
  const arc = Array.from({ length: arcSteps }, (_, index) => {
    const startAngle = yaw - volume.halfAngle + (volume.halfAngle * 2 * index) / arcSteps;
    const endAngle = yaw - volume.halfAngle + (volume.halfAngle * 2 * (index + 1)) / arcSteps;
    return {
      end: addVec3(origin, scaleVec3([Math.cos(endAngle), 0, Math.sin(endAngle)], volume.range)),
      material,
      start: addVec3(origin, scaleVec3([Math.cos(startAngle), 0, Math.sin(startAngle)], volume.range)),
      thickness: 0.03,
    } satisfies Segment;
  });

  return [...edgeSegments, ...arc];
};

const ovoidSegments = (volume: Extract<AwarenessVolumeDebug, { readonly kind: 'ovoid' }>): readonly Segment[] => {
  const center: Vec3 = volume.position;
  const forward = normalizeHorizontal(volume.forward);
  const right: Vec3 = [forward[2], 0, -forward[0]];
  const up: Vec3 = [0, 1, 0];
  const material = materialForVolume(volume);
  const steps = 34;

  const ring = (
    axisA: Vec3,
    radiusA: number,
    axisB: Vec3,
    radiusB: number,
  ): readonly Segment[] => Array.from({ length: steps }, (_, index) => {
    const a = (Math.PI * 2 * index) / steps;
    const b = (Math.PI * 2 * (index + 1)) / steps;
    const point = (angle: number): Vec3 => {
      return [
        center[0] + axisA[0] * Math.cos(angle) * radiusA + axisB[0] * Math.sin(angle) * radiusB,
        center[1] + axisA[1] * Math.cos(angle) * radiusA + axisB[1] * Math.sin(angle) * radiusB,
        center[2] + axisA[2] * Math.cos(angle) * radiusA + axisB[2] * Math.sin(angle) * radiusB,
      ];
    };

    return {
      end: point(b),
      material,
      start: point(a),
      thickness: 0.024,
    } satisfies Segment;
  });

  return [
    ...ring(right, volume.radii[0], forward, volume.radii[2]),
    ...ring(forward, volume.radii[2], up, volume.radii[1]),
    ...ring(right, volume.radii[0], up, volume.radii[1]),
  ];
};

const volumeSegments = (
  volumes: readonly AwarenessVolumeDebug[],
): readonly Segment[] => volumes.flatMap((volume) =>
  volume.kind === 'cone' ? coneSegments(volume) : ovoidSegments(volume)
);

const renderFrame = (frame: RenderFrame, cameraView: OrbitCameraView): ReactNode => {
  const camera = orbitPerspectiveCamera({
    far: 100,
    fovY: Math.PI / 4,
    near: 0.1,
    view: cameraView,
  });
  const segments = volumeSegments(frame.awarenessVolumes);

  return (
    <scene>
      <pass camera={camera} clearColor={[0.035, 0.043, 0.046, 1]}>
        <directionalLight color={[1.24, 1.16, 1.02, 1]} direction={[-0.45, -0.74, -0.35]} />
        <directionalLight color={[0.38, 0.55, 0.75, 1]} direction={[0.58, -0.42, 0.34]} />
        {defaultRapierArenaBoxes.map((box) =>
          mesh({
            geometry: unitBox,
            material: materialForArenaBox(box.id),
            transform: {
              position: box.position,
              rotation: [0, 0, 0],
              scale: box.scale,
            },
          })
        )}
        {segments.map((segment) =>
          mesh({
            geometry: unitBox,
            material: segment.material,
            transform: segmentTransform(segment.start, segment.end, segment.thickness),
          })
        )}
        {frame.actors.map((actor) =>
          mesh({
            geometry: unitBox,
            material: materialForActor(actor),
            transform: {
              position: actor.position,
              rotation: [0, yawFromForward(actor.forward), 0],
              scale: actor.scale,
            },
          })
        )}
        {frame.actors
          .filter((actor) => actor.proxy === 'blocking' && actor.band !== 'local')
          .map((actor) =>
            mesh({
              geometry: unitBox,
              material: proxyMaterial,
              transform: {
                position: actor.position,
                rotation: [0, yawFromForward(actor.forward), 0],
                scale: [
                  actor.scale[0] * 1.14,
                  actor.scale[1] * 1.05,
                  actor.scale[2] * 1.14,
                ],
              },
            })
          )}
        {frame.actors
          .filter((actor) => actor.band === 'local' || actor.staleTicks > 0 || authorityGap(actor) > 0.03)
          .map((actor) =>
            mesh({
              geometry: unitBox,
              material: authorityMaterial,
              transform: {
                position: actor.authorityPosition,
                rotation: [0, yawFromForward(actor.authorityForward), 0],
                scale: [
                  actor.authorityScale[0] * 1.22,
                  actor.authorityScale[1] * 1.1,
                  actor.authorityScale[2] * 1.22,
                ],
              },
            })
          )}
      </pass>
    </scene>
  );
};

export const DonnybrookViewport = (): ReactNode => {
  const frame = useNetworkedLabSelector(selectRenderScene);
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);

  return (
    <Canvas
      aria-label="Donnybrook awareness physics"
      renderer={renderer}
      style={canvasStyle}
    >
      {renderFrame(frame, cameraView)}
      <OrbitControls
        defaultView={defaultCameraView}
        onChange={setCameraView}
        rotateSpeed={0.006}
        zoomSpeed={0.0018}
      />
    </Canvas>
  );
};
