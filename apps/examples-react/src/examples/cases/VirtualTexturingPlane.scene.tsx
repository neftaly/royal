/** @jsxImportSource @royal/react */
import { planeGeometry, type RenderRoot, type UnlitMaterial } from '@royal/renderer-core';

export type SurfaceView = {
  readonly offset: readonly [number, number];
  readonly rotation: readonly [number, number];
  readonly zoom: number;
};

const surfaceGeometry = planeGeometry({ size: [5.2, 3.4] });

export const virtualTexturingScene = (
  surfaceMaterial: UnlitMaterial,
  view: SurfaceView,
): RenderRoot => (
  <scene>
    <pass clearColor={[0.035, 0.045, 0.052, 1]}>
      <perspectiveCamera
        far={100}
        fovY={Math.PI / 5}
        near={0.1}
        position={[view.offset[0], view.offset[1], view.zoom]}
        rotation={[0, 0, 0]}
      />
      <mesh
        geometry={surfaceGeometry}
        material={surfaceMaterial}
        transform={{
          position: [0, 0, 0],
          rotation: [view.rotation[0], view.rotation[1], 0],
        }}
      />
    </pass>
  </scene>
) as RenderRoot;
