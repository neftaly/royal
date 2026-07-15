import type { Vec3 } from "@royal/renderer-core";

/** Diffuse spherical-harmonic approximation of Royal's built-in studio environment. */
export const STUDIO_ENVIRONMENT_IRRADIANCE: readonly Vec3[] = [
  [0.78, 0.78, 0.82],
  [0.05, 0.06, 0.08],
  [0.34, 0.35, 0.38],
  [-0.08, -0.08, -0.07],
  [0.02, 0.02, 0.02],
  [0.05, 0.05, 0.06],
  [-0.18, -0.17, -0.16],
  [-0.03, -0.03, -0.02],
  [0.04, 0.04, 0.04],
];
