/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useFrame,
  useFrameIndex,
  useOrbitCamera,
  type RenderObjectHandle,
} from '@royal/react';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import {
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { htmlColor } from '../color';
import { layoutFlexTree } from '../flex-layout';
import {
  HudPass,
  HudRect,
  HudText,
  hudBoxWithWidth,
} from '../hud';
import { exampleRenderer } from '../rendering';
import { useAtkinsonFont } from './text-font';

const hudSize = {
  height: 9,
  width: 16,
} as const;

type HudBoxId =
  | 'comms'
  | 'commsBody'
  | 'commsTitle'
  | 'energyLabel'
  | 'energyTrack'
  | 'mission'
  | 'missionBody'
  | 'missionTitle'
  | 'readout'
  | 'shieldLabel'
  | 'shieldTrack'
  | 'status';

const hudBoxes = layoutFlexTree<HudBoxId>({
  direction: 'column',
  gap: 0.18,
  height: hudSize.height,
  padding: {
    left: 0.55,
    top: 0.45,
  },
  width: hudSize.width,
  children: [
    {
      id: 'status',
      direction: 'column',
      gap: 0.12,
      height: 2.18,
      padding: 0.24,
      width: 4.8,
      children: [
        { height: 0.34, id: 'readout' },
        { height: 0.24, id: 'shieldLabel' },
        { height: 0.26, id: 'shieldTrack' },
        { height: 0.24, id: 'energyLabel' },
        { height: 0.26, id: 'energyTrack' },
      ],
    },
    {
      id: 'mission',
      direction: 'column',
      gap: 0.1,
      height: 1.22,
      padding: 0.22,
      width: 4.8,
      children: [
        { height: 0.26, id: 'missionTitle' },
        { height: 0.58, id: 'missionBody' },
      ],
    },
    {
      id: 'comms',
      direction: 'column',
      gap: 0.1,
      height: 1.02,
      padding: 0.22,
      width: 3.75,
      children: [
        { height: 0.24, id: 'commsTitle' },
        { height: 0.42, id: 'commsBody' },
      ],
    },
  ],
});

const Scout = (): ReactNode => {
  const target = useRef<RenderObjectHandle | null>(null);

  useFrame(({ elapsed }) => {
    target.current?.rotation.set(0.24 + elapsed * 0.16, elapsed * 0.72, 0.12);
  });

  return (
    <mesh
      ref={target}
      transform={{
        position: [0, 0.15, 0],
        rotation: [0.24, 0.6, 0.12],
      }}
    >
      <boxGeometry size={[1.08, 1.08, 1.08]} />
      <standardMaterial color={htmlColor('#3ccfc3')} />
    </mesh>
  );
};

const HudReadout = ({
  font,
}: {
  readonly font: TextFontFace;
}): ReactNode => {
  const frame = useFrameIndex();
  const palette = useMemo(() => ({
    amber: htmlColor('#ffb84f'),
    cyan: htmlColor('#8ee8ff'),
    energy: htmlColor('#7c8cff'),
    panel: htmlColor('#071116'),
    panelAlt: htmlColor('#0c1920'),
    shield: htmlColor('#55e08a'),
    text: htmlColor('#e7f7f4'),
    track: htmlColor('#1a2b31'),
  }), []);
  const shield = 0.68 + Math.sin(frame * 0.045) * 0.08;
  const energy = 0.46 + Math.cos(frame * 0.038) * 0.12;
  const shieldFill = hudBoxWithWidth(hudBoxes.shieldTrack, hudBoxes.shieldTrack.width * shield);
  const energyFill = hudBoxWithWidth(hudBoxes.energyTrack, hudBoxes.energyTrack.width * energy);

  return (
    <>
      <HudRect box={hudBoxes.status} color={palette.panel} />
      <HudRect box={hudBoxes.mission} color={palette.panelAlt} />
      <HudRect box={hudBoxes.comms} color={palette.panel} />
      <HudRect box={hudBoxes.shieldTrack} color={palette.track} />
      <HudRect box={shieldFill} color={palette.shield} />
      <HudRect box={hudBoxes.energyTrack} color={palette.track} />
      <HudRect box={energyFill} color={palette.energy} />

      <HudText box={hudBoxes.readout} color={palette.text} font={font} fontSize={0.3}>
        ROYAL HUD / T-04
      </HudText>
      <HudText box={hudBoxes.shieldLabel} color={palette.shield} font={font} fontSize={0.19}>
        SHIELD {Math.round(shield * 100)}%
      </HudText>
      <HudText box={hudBoxes.energyLabel} color={palette.energy} font={font} fontSize={0.19}>
        ENERGY {Math.round(energy * 100)}%
      </HudText>
      <HudText box={hudBoxes.missionTitle} color={palette.amber} font={font} fontSize={0.2}>
        OBJECTIVE
      </HudText>
      <HudText box={hudBoxes.missionBody} color={palette.text} font={font} fontSize={0.22} lineHeight={0.28}>
        Hold orbit while the scan resolves.
      </HudText>
      <HudText box={hudBoxes.commsTitle} color={palette.cyan} font={font} fontSize={0.18}>
        COMMS
      </HudText>
      <HudText box={hudBoxes.commsBody} color={palette.text} font={font} fontSize={0.2} lineHeight={0.25}>
        Beacon locked.
      </HudText>
    </>
  );
};

export const HudOverlay = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const orbit = useOrbitCamera({
    distance: 5.5,
    pitch: -0.05,
    target: [0, 0, 0],
  });

  if (fontState.status !== 'ready') return null;

  return (
    <Canvas
      aria-label="HUD overlay"
      renderer={exampleRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} clearColor={htmlColor('#071015')}>
          <directionalLight color={[1.2, 1.15, 1.04, 1]} direction={[-0.48, -0.64, -0.58]} />
          <directionalLight color={[0.35, 0.55, 0.9, 1]} direction={[0.65, -0.2, 0.46]} />
          <mesh transform={{ position: [0, -0.78, -0.2], rotation: [-Math.PI / 2, 0, 0] }}>
            <planeGeometry size={[7.2, 4.8]} />
            <standardMaterial color={htmlColor('#142025')} />
          </mesh>
          <mesh transform={{ position: [-1.72, -0.25, -0.2], rotation: [0.08, 0.32, 0] }}>
            <boxGeometry size={[0.44, 0.44, 2.4]} />
            <standardMaterial color={htmlColor('#f97356')} />
          </mesh>
          <Scout />
          <mesh transform={{ position: [1.72, -0.25, -0.2], rotation: [0.08, -0.32, 0] }}>
            <boxGeometry size={[0.44, 0.44, 2.4]} />
            <standardMaterial color={htmlColor('#8f7aff')} />
          </mesh>
        </pass>
        <HudPass height={hudSize.height} width={hudSize.width}>
          <HudReadout font={fontState.font} />
        </HudPass>
      </scene>
      <OrbitControls
        {...orbit.controls}
        maxDistance={12}
        minDistance={2.6}
      />
    </Canvas>
  );
};
