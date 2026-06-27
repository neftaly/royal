/** @jsxImportSource @royal/react */
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@royal/react';

const helmetSrc = `${import.meta.env.BASE_URL}DamagedHelmet/DamagedHelmet.gltf`;

const Gltf = (): ReactNode => {
  const renderScene = (
    <scene>
      <pass>
        <perspectiveCamera
          position={[0, 1, 5]}
          rotation={[0, 0, 0]}
          fovY={Math.PI / 4}
          near={0.1}
          far={1000}
        />
        <directionalLight direction={[1, -2, -1]} color={[1, 1, 1, 1]} />
        <gltf
          src={helmetSrc}
          transform={{
            position: [0, 1, 0],
            rotation: [0, 0, 0],
            scale: [0.32, 0.32, 0.32],
          }}
        />
      </pass>
    </scene>
  );

  return createElement(Canvas, { children: renderScene });
};

export default Gltf;
