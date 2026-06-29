/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  standardMaterial,
  type RenderRoot,
} from '@royal/renderer-core';

const cube = boxGeometry({ size: [1.5, 1.5, 1.5] });
const cubeMaterial = standardMaterial({
  baseColor: solidTexture({ color: [0.9, 0.2, 0.16, 1] }),
});

export const helloCubeScene = (): RenderRoot => (
  <scene>
    <pass clearColor={[0.06, 0.08, 0.1, 1]}>
      <perspectiveCamera
        far={1000}
        fovY={Math.PI / 4}
        near={0.1}
        position={[0, 0.2, 5]}
        rotation={[0, 0, 0]}
      />
      <directionalLight color={[1, 1, 1, 1]} direction={[0.8, -1.8, -1]} />
      <mesh
        geometry={cube}
        material={cubeMaterial}
        transform={{
          position: [0, 0, 0],
          rotation: [0.45, 0.7, 0.05],
        }}
      />
    </pass>
  </scene>
) as RenderRoot;
