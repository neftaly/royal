import type {
  CanonicalEnvironment,
  CanonicalSurfaceScene,
} from "./scene-lowering";

export type CanonicalSceneUniformStorage = Readonly<{
  environmentSettings: Float32Array;
  presentation: Float32Array;
}>;

/** Allocates one owner-retained workspace for scene-wide vec4 uniforms. */
export const createCanonicalSceneUniformStorage = (): CanonicalSceneUniformStorage => ({
  environmentSettings: new Float32Array(4),
  presentation: new Float32Array(4),
});

/** Packs environment radiance and the largest authored roughness mip index. */
export const packCanonicalEnvironmentUniformsInto = (
  environment: CanonicalEnvironment,
  prefilteredMipCount: number | undefined,
  output: CanonicalSceneUniformStorage,
): void => {
  output.environmentSettings[0] = environment.radianceScaleNits;
  output.environmentSettings[1] = (prefilteredMipCount ?? 1) - 1;
  output.environmentSettings[2] = 0;
  output.environmentSettings[3] = 0;
};

/** Packs exposure and the closed tone-mapping choice without allocating. */
export const packCanonicalPresentationUniformsInto = (
  scene: Pick<CanonicalSurfaceScene, "exposure" | "toneMapping">,
  output: CanonicalSceneUniformStorage,
): void => {
  output.presentation[0] = scene.exposure;
  output.presentation[1] = scene.toneMapping === "pbr-neutral" ? 1 : 0;
  output.presentation[2] = 0;
  output.presentation[3] = 0;
};
