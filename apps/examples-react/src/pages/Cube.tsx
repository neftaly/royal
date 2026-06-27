/** @jsxImportSource @royal/react */
import {
  createElement,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Canvas,
  boxGeometry,
  standardMaterial,
  type EulerRads,
} from "@royal/react";

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });

const Cube = (): ReactNode => {
  const [rotation, setRotation] = useState<EulerRads>([0, 0, 0]);

  const rotateCube = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.buttons !== 1) return;

    setRotation(([x, y, z]) => [
      x + event.movementY / 100,
      y + event.movementX / 100,
      z,
    ]);
  };

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
        <mesh
          geometry={cube}
          material={red}
          transform={{ position: [0, 0, 0], rotation }}
        />
      </pass>
    </scene>
  );

  return createElement(Canvas, {
    children: renderScene,
    onPointerMove: rotateCube,
  });
};

export default Cube;
