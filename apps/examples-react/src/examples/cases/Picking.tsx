/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  orthographicCamera,
  planeGeometry,
  unlitMaterial,
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

type PickedId = 'cube' | 'slab' | 'tower' | 'none';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const canvasStyle = {
  cursor: 'pointer',
  touchAction: 'none',
} satisfies CSSProperties;

const camera = orthographicCamera({
  bottom: -1.35,
  far: 20,
  left: -2.2,
  near: 0.1,
  position: [0, 0, 5],
  right: 2.2,
  rotation: [0, 0, 0],
  top: 1.35,
});

const backplateGeometry = planeGeometry([4.6, 2.75]);
const cubeGeometry = boxGeometry([0.7, 0.7, 0.7]);
const slabGeometry = boxGeometry([1.05, 0.42, 0.62]);
const towerGeometry = boxGeometry([0.56, 1.16, 0.56]);

const backplateMaterial = unlitMaterial({ color: [0.09, 0.12, 0.14, 1] });
const shadowMaterial = unlitMaterial({ color: [0.02, 0.025, 0.03, 1] });
const inactiveMaterials = {
  cube: unlitMaterial({ color: [0.13, 0.72, 0.66, 1] }),
  slab: unlitMaterial({ color: [0.92, 0.38, 0.24, 1] }),
  tower: unlitMaterial({ color: [0.46, 0.5, 0.86, 1] }),
} as const;
const selectedMaterials = {
  cube: unlitMaterial({ color: [0.3, 0.95, 0.83, 1] }),
  slab: unlitMaterial({ color: [1, 0.62, 0.32, 1] }),
  tower: unlitMaterial({ color: [0.68, 0.72, 1, 1] }),
} as const;

const readoutLabel = (picked: PickedId): string => {
  switch (picked) {
    case 'cube':
      return 'Cube';
    case 'slab':
      return 'Slab';
    case 'tower':
      return 'Tower';
    case 'none':
      return 'None';
  }
};

const PickingPointerControls = ({
  onPick,
}: {
  readonly onPick: (picked: PickedId) => void;
}): null => {
  const canvas = useCanvasElement();
  const pick = useCanvasPick();

  useEffect(() => {
    if (canvas === null) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      const hit = pick(event);
      const id = hit?.target.id;
      onPick(id === 'cube' || id === 'slab' || id === 'tower' ? id : 'none');
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [canvas, onPick, pick]);

  return null;
};

export const Picking = (): ReactNode => {
  const [picked, setPicked] = useState<PickedId>('none');

  return createElement(
    'div',
    { className: 'picking-demo', 'data-picked-id': picked },
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
              <mesh
                geometry={backplateGeometry}
                material={backplateMaterial}
                transform={{
                  position: [0, 0, -0.9],
                  rotation: [0, 0, 0],
                }}
              />
              <mesh
                geometry={slabGeometry}
                material={shadowMaterial}
                transform={{
                  position: [-1.24, -0.42, -0.35],
                  rotation: [0, 0, 0],
                }}
              />
              <mesh
                geometry={slabGeometry}
                material={shadowMaterial}
                transform={{
                  position: [0, -0.48, -0.35],
                  rotation: [0, 0, 0],
                }}
              />
              <mesh
                geometry={slabGeometry}
                material={shadowMaterial}
                transform={{
                  position: [1.24, -0.46, -0.35],
                  rotation: [0, 0, 0],
                }}
              />
              <mesh
                geometry={cubeGeometry}
                material={picked === 'cube' ? selectedMaterials.cube : inactiveMaterials.cube}
                pickingId="cube"
                transform={{
                  position: [-1.24, 0, 0],
                  rotation: [0.45, 0.55, 0.12],
                }}
              />
              <mesh
                geometry={slabGeometry}
                material={picked === 'slab' ? selectedMaterials.slab : inactiveMaterials.slab}
                pickingId="slab"
                transform={{
                  position: [0, -0.04, 0],
                  rotation: [-0.12, 0.35, 0.08],
                }}
              />
              <mesh
                geometry={towerGeometry}
                material={picked === 'tower' ? selectedMaterials.tower : inactiveMaterials.tower}
                pickingId="tower"
                transform={{
                  position: [1.24, 0.08, 0],
                  rotation: [0.16, -0.42, -0.08],
                }}
              />
            </pass>
          </scene>
          <PickingPointerControls onPick={setPicked} />
        </Canvas>
      ),
    ),
    createElement(
      'div',
      {
        className: 'picking-readout',
        'data-picked-id': picked,
        'data-picking-readout': true,
      },
      createElement('span', null, 'Selected'),
      createElement('strong', null, readoutLabel(picked)),
    ),
  );
};
