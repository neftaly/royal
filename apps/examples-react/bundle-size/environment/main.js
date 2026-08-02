import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@royal/react';
import {
  perspectiveCamera,
  scene,
  studioEnvironment,
} from '@royal/react/scene';

const environmentScene = scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  environment: studioEnvironment(),
  nodes: [],
});

createRoot(document.getElementById('root')).render(
  React.createElement(Canvas, { scene: environmentScene }),
);
