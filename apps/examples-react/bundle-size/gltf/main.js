import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@royal/react';
import { gltf, perspectiveCamera, scene } from '@royal/react/scene';

const modelScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  nodes: [gltf({ src: '/model.glb' })],
});

createRoot(document.getElementById('root')).render(
  React.createElement(Canvas, { scene: modelScene }),
);
