import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@royal/react';
import { perspectiveCamera, scene } from '@royal/react/scene';

const clearScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.05, 0.1, 0.2, 1],
  nodes: [],
});

createRoot(document.getElementById('root')).render(
  React.createElement(Canvas, { scene: clearScene }),
);
