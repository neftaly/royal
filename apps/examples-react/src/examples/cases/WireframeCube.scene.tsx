/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  type RenderNode,
  type RenderRoot,
  wireframeMaterial,
} from '@royal/renderer-core';

const cubeGeometry = boxGeometry({ size: [2.25, 2.25, 2.25] });
const cubeMaterial = wireframeMaterial({
  baseColor: solidTexture({ color: [0.38, 0.85, 0.95, 1] }),
});

const wireframeCube = (frame: number): RenderNode => {
  const spin = frame * 0.012;

  return (
    <mesh
      geometry={cubeGeometry}
      material={cubeMaterial}
      transform={{
        position: [0, 0, 0],
        rotation: [0.42 + spin * 0.28, 0.7 + spin, 0.12],
      }}
    />
  ) as RenderNode;
};

export const wireframeScene = (frame: number): RenderRoot => (
  <scene>
    <pass clearColor={[0.04, 0.06, 0.08, 1]}>
      <perspectiveCamera
        far={100}
        fovY={Math.PI / 4}
        near={0.1}
        position={[0, 0.08, 6]}
        rotation={[0, 0, 0]}
      />
      {wireframeCube(frame)}
    </pass>
  </scene>
) as RenderRoot;
