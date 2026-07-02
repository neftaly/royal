/** @jsxImportSource @royal/react */
import { planeGeometry, unlitMaterial, type GltfOptions } from '@royal/renderer-core';
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import {
  createElement,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { exampleRenderer } from '../rendering';

const canvasStyle = {
  cursor: 'pointer',
  touchAction: 'none',
} satisfies CSSProperties;

const backplateGeometry = planeGeometry([4.4, 2.65]);
const backplateMaterial = unlitMaterial({ color: [0.08, 0.1, 0.12, 1] });
const activeBackplateMaterial = unlitMaterial({ color: [0.1, 0.2, 0.19, 1] });
const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';

const helmetTransform = (active: boolean): NonNullable<GltfOptions['transform']> => ({
  position: [0, -0.08, active ? 0.06 : 0],
  rotation: [0, active ? 0.5 : 0.34, 0],
  scale: active ? [1.16, 1.16, 1.16] : [1.08, 1.08, 1.08],
});

export const Picking = (): ReactNode => {
  const [hovered, setHovered] = useState(false);
  const [clicks, setClicks] = useState(0);
  const active = hovered || clicks % 2 === 1;
  const orbit = useOrbitCamera({
    distance: 3.5,
    pitch: 0.04,
    target: [0, -0.08, 0],
  });

  return createElement(
    'div',
    { className: 'picking-demo', 'data-hovered-id': hovered ? 'helmet' : 'none' },
    createElement(
      'div',
      { className: 'picking-stage' },
      (
        <Canvas
          aria-label="Pickable helmet"
          renderer={exampleRenderer}
          style={canvasStyle}
        >
          <scene>
            <pass camera={orbit.camera} clearColor={[0.035, 0.045, 0.05, 1]}>
              <directionalLight color={[1.28, 1.2, 1.05, 1]} direction={[0.36, -0.72, -1]} />
              <mesh
                geometry={backplateGeometry}
                material={active ? activeBackplateMaterial : backplateMaterial}
                transform={{
                  position: [0, 0, -0.9],
                  rotation: [0, 0, 0],
                }}
              />
              <model
                onClick={() => setClicks((count) => count + 1)}
                onPointerEnter={() => setHovered(true)}
                onPointerLeave={() => setHovered(false)}
                src={helmetSrc}
                transform={helmetTransform(active)}
              />
            </pass>
          </scene>
          <OrbitControls {...orbit.controls} />
        </Canvas>
      ),
    ),
    createElement(
      'div',
      {
        className: 'picking-readout',
        'data-hovered-id': hovered ? 'helmet' : 'none',
        'data-picking-readout': true,
      },
      createElement('span', null, 'Target'),
      createElement('strong', null, active ? `Helmet ${clicks}` : 'Helmet'),
    ),
  );
};
