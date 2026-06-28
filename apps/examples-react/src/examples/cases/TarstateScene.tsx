import {
  Canvas,
  boxGeometry,
  mesh,
  orthographicCamera,
  pass,
  scene,
  text,
  unlitMaterial,
  type Material,
  type RenderRoot,
  type Vec3,
} from '@royal/react';
import type { ReactNode } from 'react';
import { interactionState } from '../demo-data';

const panel = boxGeometry({ size: [1, 1, 0.08] });
const amber = unlitMaterial({ color: [0.92, 0.55, 0.12, 1] });
const charcoal = unlitMaterial({ color: [0.1, 0.11, 0.13, 1] });
const softBlue = unlitMaterial({ color: [0.16, 0.26, 0.42, 1] });
const rootOptions = { alpha: true, antialias: true } as const;

const layoutPanel = (
  position: Vec3,
  scale: Vec3,
  material: Material = softBlue,
): ReturnType<typeof mesh> =>
  mesh({
    geometry: panel,
    material,
    transform: {
      position,
      rotation: [0, 0, 0],
      scale,
    },
  });

const tarstateScene = (activeBoxId: string | undefined): RenderRoot =>
  scene({
    children: [
      pass({
        camera: orthographicCamera({
          position: [0, 0, 6],
          rotation: [0, 0, 0],
          left: -6,
          right: 6,
          bottom: -3.5,
          top: 3.5,
          near: 0.1,
          far: 100,
        }),
        children: [
          layoutPanel([-1.9, 0.2, 0], [4.9, 3.1, 1], activeBoxId === 'viewport' ? amber : softBlue),
          layoutPanel([3.35, 1.5, 0], [2.2, 1.15, 1], activeBoxId === 'cube-control' ? amber : charcoal),
          layoutPanel([3.35, -0.65, 0], [2.2, 1.95, 1]),
          text({
            color: [0.92, 0.94, 0.96, 1],
            fontSize: 0.34,
            lineHeight: 0.46,
            origin: [-4.0, 0.35, 0.1],
            text: 'viewport',
          }),
          text({
            color: [0.92, 0.94, 0.96, 1],
            fontSize: 0.28,
            lineHeight: 0.4,
            origin: [2.45, 1.55, 0.1],
            text: 'cube control',
          }),
          text({
            color: [0.92, 0.94, 0.96, 1],
            fontSize: 0.25,
            lineHeight: 0.36,
            origin: [2.45, -0.35, 0.1],
            text: 'probe rows',
          }),
        ],
      }),
    ],
  });

export const TarstateScene = (): ReactNode => (
  <Canvas aria-label="Tarstate workbench scene" rootOptions={rootOptions}>
    {tarstateScene(interactionState.activeId)}
  </Canvas>
);
