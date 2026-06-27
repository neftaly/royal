/** @jsxImportSource @royal/react */
import { createElement } from 'react';
import type { ReactNode } from 'react';
import {
  Canvas,
  boxGeometry,
  standardMaterial,
  type Vec3,
} from '@royal/react';

type Edge = {
  readonly position: Vec3;
  readonly scale: Vec3;
};

const edgeGeometry = boxGeometry({ size: [1, 1, 1] });
const cyan = standardMaterial({ color: [0, 0.85, 1, 1] });
const thickness = 0.035;
const length = 1;

// Mesh edges avoid native GL line-width limits.
const edges: readonly Edge[] = [
  { position: [0, -0.5, -0.5], scale: [length, thickness, thickness] },
  { position: [0, 0.5, -0.5], scale: [length, thickness, thickness] },
  { position: [0, -0.5, 0.5], scale: [length, thickness, thickness] },
  { position: [0, 0.5, 0.5], scale: [length, thickness, thickness] },
  { position: [-0.5, 0, -0.5], scale: [thickness, length, thickness] },
  { position: [0.5, 0, -0.5], scale: [thickness, length, thickness] },
  { position: [-0.5, 0, 0.5], scale: [thickness, length, thickness] },
  { position: [0.5, 0, 0.5], scale: [thickness, length, thickness] },
  { position: [-0.5, -0.5, 0], scale: [thickness, thickness, length] },
  { position: [0.5, -0.5, 0], scale: [thickness, thickness, length] },
  { position: [-0.5, 0.5, 0], scale: [thickness, thickness, length] },
  { position: [0.5, 0.5, 0], scale: [thickness, thickness, length] },
];

const Wireframe = (): ReactNode => {
  const renderScene = (
    <scene>
      <pass>
        <perspectiveCamera
          position={[0, 0, 5]}
          rotation={[0, 0, 0]}
          fovY={Math.PI / 4}
          near={0.1}
          far={1000}
        />
        <directionalLight direction={[1, -2, -1]} color={[1, 1, 1, 1]} />
        {edges.map((edge) => (
          <mesh
            geometry={edgeGeometry}
            material={cyan}
            transform={{
              position: edge.position,
              rotation: [0, 0, 0],
              scale: edge.scale,
            }}
          />
        ))}
      </pass>
    </scene>
  );

  return createElement(Canvas, { children: renderScene });
};

export default Wireframe;
