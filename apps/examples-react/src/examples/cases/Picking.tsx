/** @jsxImportSource @royal/react */
import {
  perspectiveCamera,
  planeGeometry,
  unlitMaterial,
  type GltfOptions,
} from '@royal/renderer-core';
import {
  Canvas,
  useCanvasElement,
  useCanvasPick,
} from '@royal/react';
import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

type HoveredId = 'helmet' | 'none';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const canvasStyle = {
  cursor: 'pointer',
  touchAction: 'none',
} satisfies CSSProperties;

const camera = perspectiveCamera({
  far: 20,
  fovY: Math.PI / 4,
  near: 0.1,
  position: [0, 0, 3.5],
  rotation: [0, 0, 0],
});

const backplateGeometry = planeGeometry([4.6, 2.75]);
const backplateMaterial = unlitMaterial({ color: [0.08, 0.105, 0.12, 1] });
const hoverPlateMaterial = unlitMaterial({ color: [0.12, 0.24, 0.23, 1] });
const helmetSrc = import.meta.env.BASE_URL + 'DamagedHelmet/DamagedHelmet.gltf';
const helmetTransform = (hovered: boolean): NonNullable<GltfOptions['transform']> => ({
  position: [0, -0.08, hovered ? 0.06 : 0],
  rotation: [0, hovered ? 0.48 : 0.34, 0],
  scale: hovered ? [1.18, 1.18, 1.18] : [1.08, 1.08, 1.08],
});

const PickingPointerControls = ({
  onPick,
}: {
  readonly onPick: (picked: HoveredId) => void;
}): null => {
  const canvas = useCanvasElement();
  const pick = useCanvasPick();

  useEffect(() => {
    if (canvas === null) return undefined;

    const handlePointerMove = (event: PointerEvent): void => {
      const hit = pick(event);
      const id = hit?.target.id;
      onPick(id === 'helmet' ? id : 'none');
    };
    const handlePointerLeave = (): void => {
      onPick('none');
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [canvas, onPick, pick]);

  return null;
};

export const Picking = (): ReactNode => {
  const [hovered, setHovered] = useState<HoveredId>('none');

  return createElement(
    'div',
    { className: 'picking-demo', 'data-hovered-id': hovered },
    createElement(
      'div',
      { className: 'picking-stage' },
      (
        <Canvas
          aria-label="Pickable Royal objects"
          renderer={renderer}
          style={canvasStyle}
        >
          <scene>
            <pass camera={camera} clearColor={[0.035, 0.045, 0.05, 1]}>
              <directionalLight color={[1.28, 1.2, 1.05, 1]} direction={[0.36, -0.72, -1]} />
              <mesh
                geometry={backplateGeometry}
                material={hovered === 'helmet' ? hoverPlateMaterial : backplateMaterial}
                transform={{
                  position: [0, 0, -0.9],
                  rotation: [0, 0, 0],
                }}
              />
              <gltf
                pickingId="helmet"
                src={helmetSrc}
                transform={helmetTransform(hovered === 'helmet')}
              />
            </pass>
          </scene>
          <PickingPointerControls onPick={setHovered} />
        </Canvas>
      ),
    ),
    createElement(
      'div',
      {
        className: 'picking-readout',
        'data-hovered-id': hovered,
        'data-picking-readout': true,
      },
      createElement('span', null, 'Hovered'),
      createElement('strong', null, hovered === 'helmet' ? 'Damaged Helmet' : 'None'),
    ),
  );
};
