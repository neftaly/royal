import {
  boxGeometry,
  directionalLight,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  type Material,
  type Scene,
  unlitMaterial,
  wireframeMaterial,
} from '@royal/react/scene';
import {
  Canvas,
  OrbitControls,
} from '@royal/react';
import {
  orbitCameraTransform,
  type OrbitCameraTransform,
  type OrbitCameraView,
} from '@royal/renderer-core';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useRapierSimulation } from './rapier-react';
import {
  createRapierPhysicsSimulation,
  disposeRapierPhysicsSimulation,
  initialRapierSceneState,
  rapierPhysicsErrorFrame,
  readRapierPhysicsSimulation,
  staticPhysicsBoxes,
  stepRapierPhysicsSimulation,
  type RapierPhysicsSimulation,
  type RapierSceneState,
  type RemoteActorRenderState,
} from './RapierPhysics.scene';

const rendererOptions = {
  alpha: true,
  antialias: true,
} as const;

const orbitCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} satisfies CSSProperties;

const defaultCameraView = {
  distance: 7.2,
  pitch: 0.28,
  target: [0, 0.55, 0],
  yaw: -0.42,
} satisfies OrbitCameraView;
const orbitOptions = {
  rotateSpeed: 0.006,
  zoomSpeed: 0.0018,
} as const;

const unitBoxGeometry = boxGeometry({ size: [1, 1, 1] });

const groundMaterial = standardMaterial({ color: [0.34, 0.37, 0.33, 1] });
const wallMaterial = standardMaterial({ color: [0.48, 0.5, 0.47, 1] });
const playerMaterial = standardMaterial({ color: [0.24, 0.75, 0.9, 1] });
const serverPlayerMaterial = wireframeMaterial({ color: [1, 1, 1, 1] });
const hitscanHitMaterial = unlitMaterial({ color: [0.65, 1, 0.36, 1] });
const hitscanMissMaterial = unlitMaterial({ color: [1, 0.78, 0.2, 1] });
const hitscanMarkerMaterial = unlitMaterial({ color: [1, 1, 1, 1] });
const remoteActorMaterials = {
  cold: standardMaterial({ color: [0.42, 0.56, 0.9, 1] }),
  dormant: wireframeMaterial({ color: [0.58, 0.62, 0.66, 1] }),
  hot: standardMaterial({ color: [0.52, 0.9, 0.38, 1] }),
  warm: standardMaterial({ color: [0.96, 0.72, 0.26, 1] }),
} satisfies Record<RemoteActorRenderState['interest'], Material>;
const replicatedActorShellMaterial = wireframeMaterial({ color: [1, 1, 1, 1], width: 1 });

const materialForRemoteActor = (actor: RemoteActorRenderState): Material =>
  remoteActorMaterials[actor.interest];

const ghostScale = (
  [x, y, z]: readonly [number, number, number],
): readonly [number, number, number] => [x * 1.12, y * 1.04, z * 1.12];

const raySegmentTransform = (
  origin: readonly [number, number, number],
  endpoint: readonly [number, number, number],
): {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
} => {
  const dx = endpoint[0] - origin[0];
  const dy = endpoint[1] - origin[1];
  const dz = endpoint[2] - origin[2];
  const length = Math.max(0.001, Math.hypot(dx, dy, dz));
  const horizontal = Math.max(0.001, Math.hypot(dx, dz));

  return {
    position: [
      origin[0] + dx * 0.5,
      origin[1] + dy * 0.5,
      origin[2] + dz * 0.5,
    ],
    rotation: [
      Math.atan2(dy, horizontal),
      -Math.atan2(dz, dx),
      0,
    ],
    scale: [length, 0.035, 0.035],
  };
};

const rapierPhysicsRenderRoot = ({
  camera,
  sceneState,
}: {
  readonly camera: OrbitCameraTransform;
  readonly sceneState: RapierSceneState;
}): Scene => scene({
  children: [
    pass({
      camera: perspectiveCamera({
        far: 100,
        fovY: Math.PI / 4,
        near: 0.1,
        position: camera.position,
        rotation: camera.rotation,
      }),
      children: [
        directionalLight({ color: [1.3, 1.22, 1.04, 1], direction: [-0.35, -0.7, -0.45] }),
        directionalLight({ color: [0.42, 0.62, 0.72, 1], direction: [0.58, -0.35, 0.42] }),
        ...staticPhysicsBoxes.map((box) => mesh({
          geometry: unitBoxGeometry,
          material: box.id === 'ground' ? groundMaterial : wallMaterial,
          transform: {
            position: box.position,
            rotation: [0, 0, 0],
            scale: box.scale,
          },
        })),
        mesh({
          geometry: unitBoxGeometry,
          material: playerMaterial,
          transform: {
            position: sceneState.predictedPlayer.position,
            rotation: sceneState.predictedPlayer.rotation,
            scale: sceneState.predictedPlayer.scale,
          },
        }),
        ...sceneState.bodies.flatMap((body) => [
          mesh({
            geometry: unitBoxGeometry,
            material: materialForRemoteActor(body),
            transform: {
              position: body.position,
              rotation: body.rotation,
              scale: body.scale,
            },
          }),
          ...(body.replicated
            ? [
              mesh({
                geometry: unitBoxGeometry,
                material: replicatedActorShellMaterial,
                transform: {
                  position: body.position,
                  rotation: body.rotation,
                  scale: ghostScale(body.scale),
                },
              }),
            ]
            : []),
        ]),
        ...(sceneState.network.serverLeadTicks === 0
          ? []
          : [
            mesh({
              geometry: unitBoxGeometry,
              material: serverPlayerMaterial,
              transform: {
                position: sceneState.serverPlayer.position,
                rotation: sceneState.serverPlayer.rotation,
                scale: ghostScale(sceneState.serverPlayer.scale),
              },
            }),
          ]),
        ...(sceneState.hitscan.sequence < 0
          ? []
          : [
            mesh({
              geometry: unitBoxGeometry,
              material: sceneState.hitscan.hit ? hitscanHitMaterial : hitscanMissMaterial,
              transform: raySegmentTransform(
                sceneState.hitscan.origin,
                sceneState.hitscan.endpoint,
              ),
            }),
            mesh({
              geometry: unitBoxGeometry,
              material: hitscanMarkerMaterial,
              transform: {
                position: sceneState.hitscan.hitPosition,
                rotation: [0, 0, 0],
                scale: sceneState.hitscan.hit ? [0.16, 0.16, 0.16] : [0.1, 0.1, 0.1],
              },
            }),
          ]),
      ],
      clearColor: [0.035, 0.044, 0.046, 1],
    }),
  ],
});

export const RapierPhysics = (): ReactNode => {
  const [cameraView, setCameraView] = useState<OrbitCameraView>(defaultCameraView);
  const { frame: sceneState } = useRapierSimulation<
    RapierPhysicsSimulation,
    RapierSceneState
  >({
    createSimulation: createRapierPhysicsSimulation,
    disposeSimulation: disposeRapierPhysicsSimulation,
    errorFrame: rapierPhysicsErrorFrame,
    initialFrame: initialRapierSceneState,
    readSimulation: readRapierPhysicsSimulation,
    stepSimulation: stepRapierPhysicsSimulation,
  });
  const camera = orbitCameraTransform(cameraView);
  const scene = rapierPhysicsRenderRoot({ camera, sceneState });

  return (
    <Canvas
      aria-label="Rapier physics"
      data-rapier-network-client-tick={String(sceneState.network.clientTick)}
      data-rapier-network-dropped-inputs={String(sceneState.network.droppedInputs)}
      data-rapier-network-dropped-shots={String(sceneState.network.droppedShots)}
      data-rapier-network-dropped-snapshots={String(sceneState.network.droppedSnapshots)}
      data-rapier-network-fire-loss-every={String(sceneState.network.fireLossEvery)}
      data-rapier-hitscan-adjudications={String(sceneState.hitscan.adjudications)}
      data-rapier-hitscan-client-fire-tick={String(sceneState.hitscan.clientFireTick)}
      data-rapier-hitscan-hit={String(sceneState.hitscan.hit)}
      data-rapier-hitscan-hit-distance={String(sceneState.hitscan.hitDistance)}
      data-rapier-hitscan-hit-id={sceneState.hitscan.hitId}
      data-rapier-hitscan-hit-kind={sceneState.hitscan.hitKind}
      data-rapier-hitscan-history-frames={String(sceneState.hitscan.historyFrames)}
      data-rapier-hitscan-max-distance={String(sceneState.hitscan.maxDistance)}
      data-rapier-hitscan-mode={sceneState.hitscan.mode}
      data-rapier-hitscan-origin-error={String(sceneState.hitscan.originError)}
      data-rapier-hitscan-received-server-tick={String(sceneState.hitscan.receivedServerTick)}
      data-rapier-hitscan-rewind-age-ticks={String(sceneState.hitscan.rewindAgeTicks)}
      data-rapier-hitscan-rewind-server-tick={String(sceneState.hitscan.rewindServerTick)}
      data-rapier-hitscan-sequence={String(sceneState.hitscan.sequence)}
      data-rapier-network-interpolation={sceneState.network.interpolation}
      data-rapier-network-interpolation-buffer-frames={String(sceneState.network.interpolationBufferFrames)}
      data-rapier-network-interpolation-delay-ticks={String(sceneState.network.interpolationDelayTicks)}
      data-rapier-network-interpolation-target-server-tick={String(sceneState.network.interpolationTargetServerTick)}
      data-rapier-network-interpolation-underflows={String(sceneState.network.interpolationUnderflows)}
      data-rapier-network-interest-cold-actors={String(sceneState.network.interestColdActors)}
      data-rapier-network-interest-combat-actors={String(sceneState.network.interestCombatActors)}
      data-rapier-network-interest-dormant-actors={String(sceneState.network.interestDormantActors)}
      data-rapier-network-interest-ghost-proxies={String(sceneState.network.interestGhostProxies)}
      data-rapier-network-interest-hot-actors={String(sceneState.network.interestHotActors)}
      data-rapier-network-interest-mode={sceneState.network.interestMode}
      data-rapier-network-interest-policy-profiles={sceneState.network.interestPolicyProfiles}
      data-rapier-network-interest-blocking-proxies={String(sceneState.network.interestBlockingProxies)}
      data-rapier-network-interest-replicated-actors={String(sceneState.network.interestReplicatedActors)}
      data-rapier-network-interest-total-actors={String(sceneState.network.interestTotalActors)}
      data-rapier-network-interest-transform-actors={String(sceneState.network.interestTransformActors)}
      data-rapier-network-interest-warm-actors={String(sceneState.network.interestWarmActors)}
      data-rapier-network-last-received-server-tick={String(sceneState.network.lastReceivedServerTick)}
      data-rapier-network-mode={sceneState.network.mode}
      data-rapier-network-pending-inputs={String(sceneState.network.pendingInputs)}
      data-rapier-network-pending-predicted-inputs={String(sceneState.network.pendingPredictedInputs)}
      data-rapier-network-pending-shots={String(sceneState.network.pendingShots)}
      data-rapier-network-pending-snapshots={String(sceneState.network.pendingSnapshots)}
      data-rapier-network-predicted-tick={String(sceneState.network.predictedTick)}
      data-rapier-network-prediction={sceneState.network.prediction}
      data-rapier-network-reconciliations={String(sceneState.network.reconciliations)}
      data-rapier-network-last-prediction-error={String(sceneState.network.lastPredictionError)}
      data-rapier-network-last-reconciled-server-tick={String(sceneState.network.lastReconciledServerTick)}
      data-rapier-network-server-lead-ticks={String(sceneState.network.serverLeadTicks)}
      data-rapier-network-server-tick={String(sceneState.network.serverTick)}
      data-rapier-network-smoothing={sceneState.network.smoothing}
      data-rapier-network-smoothing-offset={String(sceneState.network.smoothingOffset)}
      data-rapier-network-smoothing-ticks-remaining={String(sceneState.network.smoothingTicksRemaining)}
      data-rapier-network-snap-correction-distance={String(sceneState.network.snapCorrectionDistance)}
      context={rendererOptions}
      style={orbitCanvasStyle}
    >
      {scene}
      <OrbitControls
        {...orbitOptions}
        defaultView={defaultCameraView}
        onChange={setCameraView}
      />
    </Canvas>
  );
};
