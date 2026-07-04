import {
  planeGeometry,
  studioEnvironment,
  unlitMaterial,
  type GltfOptions,
} from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  useState,
  type ReactNode,
} from 'react';
import { htmlColor } from '../color';
import { exampleCanvasRootOptions } from '../example-root-options';
import {
  HudPass,
  HudRect,
  HudText,
} from '../hud';
import { useAtkinsonFont } from './text-font';

const backplateGeometry = planeGeometry([4.4, 2.65]);
const backplateMaterial = unlitMaterial({ color: [0.08, 0.1, 0.12, 1] });
const activeBackplateMaterial = unlitMaterial({ color: [0.1, 0.2, 0.19, 1] });
const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.65,
  specularIntensity: 1.35,
});

const readoutPanel = {
  bottom: 1.18,
  height: 0.72,
  left: 0.52,
  right: 3.97,
  top: 0.46,
  width: 3.45,
} as const;
const readoutLabel = {
  bottom: 0.8,
  height: 0.24,
  left: 0.78,
  right: 3.38,
  top: 0.56,
  width: 2.6,
} as const;
const readoutValue = {
  bottom: 1.14,
  height: 0.28,
  left: 0.78,
  right: 3.58,
  top: 0.86,
  width: 2.8,
} as const;

const helmetTransform = (active: boolean): NonNullable<GltfOptions['transform']> => ({
  position: [0, -0.08, active ? 0.06 : 0],
  rotation: [0, active ? 0.5 : 0.34, 0],
  scale: active ? [1.16, 1.16, 1.16] : [1.08, 1.08, 1.08],
});

export const Picking = (): ReactNode => {
  const [hovered, setHovered] = useState(false);
  const [clicks, setClicks] = useState(0);
  const fontState = useAtkinsonFont();
  const active = hovered || clicks % 2 === 1;
  const hoveredId = hovered ? 'helmet' : 'none';
  const readoutText = active ? `Helmet ${clicks}` : 'Helmet';
  const orbit = useOrbitCamera({
    distance: 3.5,
    pitch: 0.04,
    target: [0, -0.08, 0],
  });

  if (fontState.status !== 'ready') return null;

  return (
    <Canvas
      aria-label="Pickable helmet"
      data-royal-picking-hovered-id={hoveredId}
      data-royal-picking-readout={`Target ${readoutText}`}
      rootOptions={exampleCanvasRootOptions}
      style={{ cursor: 'pointer', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment}>
          <directionalLight color={[0.9, 0.86, 0.78, 1]} direction={[0.36, -0.72, -1]} />
          <mesh
            geometry={backplateGeometry}
            material={active ? activeBackplateMaterial : backplateMaterial}
            transform={{
              position: [0, 0, -0.9],
              rotation: [0, 0, 0],
            }}
          />
          <gltf
            onClick={() => setClicks((count) => count + 1)}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            src={helmetSrc}
            transform={helmetTransform(active)}
          />
        </pass>
        <HudPass>
          <HudRect box={readoutPanel} color={htmlColor('#071116')} />
          <HudText
            box={readoutLabel}
            color={htmlColor('#8ee8ff')}
            font={fontState.font}
            fontSize={0.18}
          >
            TARGET
          </HudText>
          <HudText
            box={readoutValue}
            color={active ? htmlColor('#55e08a') : htmlColor('#e7f7f4')}
            font={fontState.font}
            fontSize={0.24}
          >
            {readoutText}
          </HudText>
        </HudPass>
      </scene>
      <OrbitControls {...orbit.orbitControlsProps} />
    </Canvas>
  );
};
