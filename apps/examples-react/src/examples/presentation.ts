import { studioEnvironment } from '@royal/react/scene';
import type { CSSProperties } from 'react';
import { srgbColor } from './color';

/** Neutral, deterministic environment for renderer-reference scenes. */
export const referenceEnvironment = studioEnvironment({ radianceScaleNits: 1 });

/** Brighter scene-referred studio radiance for public showcase scenes. */
export const showcaseEnvironment = studioEnvironment({ radianceScaleNits: 180 });

export const showcaseKeyLight = {
  color: srgbColor([1, 0.92, 0.8, 1]),
  direction: [0.42, -0.72, -0.56],
  illuminanceLux: 900,
} as const;

export const showcaseFillLight = {
  color: srgbColor([0.58, 0.72, 1, 1]),
  direction: [-0.64, -0.28, 0.72],
  illuminanceLux: 300,
} as const;

export const showcasePass = {
  clearColor: [0, 0, 0, 0],
  exposureEv100: 7,
  toneMapping: 'pbr-neutral',
} as const;

/** Neutral, brighter product photography rig for hero PBR assets. */
export const productEnvironment = studioEnvironment({ radianceScaleNits: 180 });

export const productKeyLight = {
  color: srgbColor([1, 0.98, 0.94, 1]),
  direction: [0.42, -0.72, -0.56],
  illuminanceLux: 1_400,
} as const;

export const productFillLight = {
  color: srgbColor([0.82, 0.9, 1, 1]),
  direction: [-0.64, -0.28, 0.72],
  illuminanceLux: 360,
} as const;

export const productPass = {
  clearColor: [0, 0, 0, 0],
  exposureEv100: 8,
  toneMapping: 'pbr-neutral',
} as const;

/** Broad, low-contrast rig that keeps textured metallic materials readable. */
export const materialEnvironment = studioEnvironment({ radianceScaleNits: 400 });

export const materialKeyLight = {
  color: srgbColor([1, 0.98, 0.94, 1]),
  direction: [0.42, -0.72, -0.56],
  illuminanceLux: 250,
} as const;

export const materialFillLight = {
  color: srgbColor([0.86, 0.92, 1, 1]),
  direction: [-0.64, -0.28, 0.72],
  illuminanceLux: 80,
} as const;

export const materialPass = {
  clearColor: [0, 0, 0, 0],
  exposureEv100: 5.75,
  toneMapping: 'pbr-neutral',
} as const;

/** Display-referred path for unlit illustration and authored 2D colors. */
export const colorAccuratePass = {
  clearColor: [0, 0, 0, 0],
  toneMapping: 'linear-clamp',
} as const;

export const interactiveCanvasStyle = {
  cursor: 'grab',
  touchAction: 'none',
} as const satisfies CSSProperties;
