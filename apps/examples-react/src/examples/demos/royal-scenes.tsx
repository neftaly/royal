import {
  boxGeometry,
  directionalLight,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  text,
  unlitMaterial,
  type EulerRads,
  type Material,
  type RenderRoot,
  type Vec3,
} from '@royal/renderer-core';

const cube = boxGeometry({ size: [1, 1, 1] });
const panel = boxGeometry({ size: [1, 1, 0.08] });
const red = standardMaterial({ color: [0.85, 0.16, 0.18, 1] });
const blue = standardMaterial({ color: [0.1, 0.4, 0.88, 1] });
const green = standardMaterial({ color: [0.13, 0.58, 0.34, 1] });
const amber = standardMaterial({ color: [0.92, 0.55, 0.12, 1] });
const charcoal = unlitMaterial({ color: [0.1, 0.11, 0.13, 1] });
const white = unlitMaterial({ color: [0.94, 0.96, 0.98, 1] });
const softBlue = unlitMaterial({ color: [0.16, 0.26, 0.42, 1] });

export const cubeScene = (rotation: EulerRads = [0.4, 0.65, 0]): RenderRoot =>
  scene({
    children: [
      pass({
        camera: perspectiveCamera({
          position: [0, 0, 5],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 1000,
        }),
        children: [
          directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] }),
          mesh({
            geometry: cube,
            material: red,
            transform: {
              position: [0, 0, 0],
              rotation,
            },
          }),
        ],
      }),
    ],
  });

export const multiObjectScene = (
  rotation: EulerRads,
  scale: number,
): RenderRoot =>
  scene({
    children: [
      pass({
        camera: perspectiveCamera({
          position: [0, 0.5, 6.5],
          rotation: [0, 0, 0],
          fovY: Math.PI / 4,
          near: 0.1,
          far: 1000,
        }),
        children: [
          directionalLight({ direction: [1, -1.8, -1], color: [1, 1, 1, 1] }),
          mesh({
            geometry: cube,
            material: blue,
            transform: {
              position: [-1.45, 0.15, 0],
              rotation,
              scale: [scale, scale, scale],
            },
          }),
          mesh({
            geometry: cube,
            material: green,
            transform: {
              position: [0.2, -0.25, -0.45],
              rotation: [rotation[0] * 0.4, rotation[1] * 0.8, 0.2],
              scale: [0.8, 1.3, 0.8],
            },
          }),
          mesh({
            geometry: cube,
            material: amber,
            transform: {
              position: [1.55, 0.35, 0.15],
              rotation: [0.15, rotation[1] * -0.75, rotation[2]],
              scale: [0.7, 0.7, 0.7],
            },
          }),
        ],
      }),
    ],
  });

export const tarstateScene = (activeBoxId: string | undefined): RenderRoot => {
  const box = (position: Vec3, scale: Vec3, material: Material = softBlue): ReturnType<typeof mesh> =>
    mesh({
      geometry: panel,
      material,
      transform: {
        position,
        rotation: [0, 0, 0],
        scale,
      },
    });

  return scene({
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
          box([-1.9, 0.2, 0], [4.9, 3.1, 1], activeBoxId === 'viewport' ? amber : softBlue),
          box([3.35, 1.5, 0], [2.2, 1.15, 1], activeBoxId === 'cube-control' ? amber : charcoal),
          box([3.35, -0.65, 0], [2.2, 1.95, 1]),
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
};

export const textLayoutScene = (label: string): RenderRoot =>
  scene({
    children: [
      pass({
        clearColor: [0.04, 0.05, 0.06, 1],
        camera: orthographicCamera({
          position: [0, 0, 8],
          rotation: [0, 0, 0],
          left: -5,
          right: 5,
          bottom: -2.8,
          top: 2.8,
          near: 0.1,
          far: 100,
        }),
        children: [
          text({
            color: [0.96, 0.96, 0.92, 1],
            fontSize: 0.72,
            lineHeight: 0.9,
            origin: [-3.9, 0.8, 0],
            text: label,
          }),
          text({
            color: [0.42, 0.72, 0.95, 1],
            fontSize: 0.36,
            lineHeight: 0.52,
            origin: [-3.9, -0.25, 0],
            text: 'layoutText -> textMesh -> vectorText node',
          }),
          mesh({
            geometry: panel,
            material: white,
            transform: {
              position: [-3.0, -1.35, -0.1],
              rotation: [0, 0, 0],
              scale: [1.7, 0.05, 1],
            },
          }),
        ],
      }),
    ],
  });
