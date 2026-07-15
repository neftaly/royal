import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@royal/react';
import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  scene,
  standardMaterial,
} from '@royal/react/scene';

const cubeScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  children: [
    mesh({
      geometry: boxGeometry(),
      material: standardMaterial({ color: 'royalblue' }),
    }),
  ],
});

createRoot(document.getElementById('root')).render(
  React.createElement(Canvas, { scene: cubeScene }),
);
