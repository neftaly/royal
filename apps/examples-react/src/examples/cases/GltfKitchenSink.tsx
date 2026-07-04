import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { studioEnvironment } from '@royal/renderer-core';
import { createElement, Fragment, type ReactNode } from 'react';
import { BenchmarkRendererSnapshot } from '../BenchmarkRendererSnapshot';
import { exampleCanvasRootOptions } from '../example-root-options';

type KitchenSinkAsset = {
  readonly bytes: number;
  readonly label: string;
  readonly name: string;
  readonly tags: readonly KitchenSinkTag[];
};

type KitchenSinkInstance = KitchenSinkAsset & {
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly src: string;
};

type KitchenSinkTag = 'core' | 'extension' | 'issues' | 'pbrtest' | 'showcase' | 'testing' | 'video';
type KitchenSinkSet = 'ok' | 'slow';

const khronosFixtureBase = import.meta.env.BASE_URL + 'fixtures/khronos/';
const khronosGltf = (name: string): string =>
  `${khronosFixtureBase}${name}/glTF-Binary/${name}.glb`;
const exampleEnvironment = studioEnvironment({
  irradianceIntensity: 0.46,
  specularIntensity: 0.82,
});

export const khronosKitchenSinkAssets = [
  { name: 'AlphaBlendModeTest', label: 'Alpha Blend Mode Test', bytes: 2978812, tags: ['core', 'testing'] },
  { name: 'AnimatedMorphCube', label: 'Animated Morph Cube', bytes: 6752, tags: ['core', 'testing'] },
  { name: 'AttenuationTest', label: 'Attenuation Test', bytes: 57532, tags: ['testing', 'extension'] },
  { name: 'Box', label: 'Box', bytes: 1664, tags: ['core', 'testing'] },
  { name: 'BoxAnimated', label: 'Box Animated', bytes: 11944, tags: ['core', 'testing'] },
  { name: 'BoxInterleaved', label: 'Box with interleaved position and normal attributes', bytes: 1632, tags: ['core', 'testing'] },
  { name: 'BoxTextured', label: 'Box Textured', bytes: 5956, tags: ['core', 'issues', 'testing'] },
  { name: 'BoxTexturedNonPowerOfTwo', label: 'Box Textured not 2^N', bytes: 4696, tags: ['core', 'issues', 'testing'] },
  { name: 'BoxVertexColors', label: 'Box Vertex Colors', bytes: 1924, tags: ['core', 'testing'] },
  { name: 'CesiumMan', label: 'Cesium Man', bytes: 438044, tags: ['core', 'issues', 'testing'] },
  { name: 'CesiumMilkTruck', label: 'Cesium Milk Truck', bytes: 369980, tags: ['core', 'issues', 'testing'] },
  { name: 'ClearCoatCarPaint', label: 'Clear Coat Car Paint', bytes: 116948, tags: ['extension', 'testing'] },
  { name: 'ClearCoatTest', label: 'KHR_materials_clearcoat Test', bytes: 258048, tags: ['testing', 'extension'] },
  { name: 'ClearcoatWicker', label: 'Clearcoat Wicker', bytes: 1299752, tags: ['extension', 'testing'] },
  { name: 'CompareBaseColor', label: 'Compare Base Color', bytes: 1507816, tags: ['core', 'testing', 'pbrtest'] },
  { name: 'CompareClearcoat', label: 'Compare Clearcoat', bytes: 193920, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareDispersion', label: 'Compare Dispersion', bytes: 60432, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareEmissiveStrength', label: 'Compare Emissive Strength', bytes: 111796, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareIor', label: 'Compare IOR', bytes: 213104, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareIridescence', label: 'Compare Iridescence', bytes: 214756, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareMetallic', label: 'Compare Metallic', bytes: 172180, tags: ['core', 'testing', 'pbrtest'] },
  { name: 'CompareNormal', label: 'Compare Normal', bytes: 220900, tags: ['core', 'testing', 'pbrtest'] },
  { name: 'CompareRoughness', label: 'Compare Roughness', bytes: 155660, tags: ['core', 'testing', 'pbrtest'] },
  { name: 'CompareSheen', label: 'Compare Sheen', bytes: 883968, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareSpecular', label: 'Compare Specular', bytes: 1408364, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareTransmission', label: 'Compare Transmission', bytes: 357024, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CompareVolume', label: 'Compare Volume', bytes: 399760, tags: ['extension', 'testing', 'pbrtest'] },
  { name: 'CubeVisibility', label: 'CubeVisibility', bytes: 3284, tags: ['testing'] },
  { name: 'DirectionalLight', label: 'Directional Light', bytes: 453520, tags: ['core', 'testing'] },
  { name: 'Duck', label: 'Duck', bytes: 120484, tags: ['core', 'testing'] },
  { name: 'EmissiveStrengthTest', label: 'Emissive Strength Test', bytes: 10668, tags: ['testing', 'extension'] },
  { name: 'Fox', label: 'Fox', bytes: 162852, tags: ['core', 'testing'] },
  { name: 'GlassBrokenWindow', label: 'Glass Broken Window', bytes: 1076624, tags: ['video', 'extension'] },
  { name: 'InterpolationTest', label: 'Interpolation Test', bytes: 7952, tags: ['core', 'testing'] },
  { name: 'IridescenceSuzanne', label: 'Iridescence Suzanne', bytes: 507608, tags: ['testing', 'extension'] },
  { name: 'LightVisibility', label: 'LightVisibility', bytes: 2940, tags: ['testing'] },
  { name: 'MetalRoughSpheresNoTextures', label: 'Metal-Rough Spheres (textureless)', bytes: 291316, tags: ['core', 'testing'] },
  { name: 'MorphPrimitivesTest', label: 'Morph-Primitives Test', bytes: 53656, tags: ['core', 'testing'] },
  { name: 'MorphStressTest', label: 'Morph Stress Test', bytes: 575900, tags: ['core', 'testing'] },
  { name: 'MultiUVTest', label: 'MultiUV Test', bytes: 43004, tags: ['core', 'testing'] },
  { name: 'NegativeScaleTest', label: 'Negative Scale Test', bytes: 62568, tags: ['core', 'testing'] },
  { name: 'NormalTangentTest', label: 'Normal-Tangent Test', bytes: 1796996, tags: ['core', 'testing'] },
  { name: 'OrientationTest', label: 'Orientation Test', bytes: 38920, tags: ['core', 'testing'] },
  { name: 'PointLightIntensityTest', label: 'Point Light Intensity Test', bytes: 30148, tags: ['extension', 'testing'] },
  { name: 'RecursiveSkeletons', label: 'Recursive Skeletons', bytes: 561620, tags: ['core', 'testing', 'issues'] },
  { name: 'RiggedFigure', label: 'Rigged Figure', bytes: 50116, tags: ['core', 'testing'] },
  { name: 'RiggedSimple', label: 'Rigged Simple', bytes: 15104, tags: ['core', 'testing'] },
  { name: 'SimpleInstancing', label: 'Simple Instancing', bytes: 7356, tags: ['extension', 'testing'] },
  { name: 'SpecularTest', label: 'Specular Test', bytes: 223376, tags: ['core', 'testing', 'extension'] },
  { name: 'SunglassesKhronos', label: 'Sunglasses Khronos', bytes: 371188, tags: ['showcase', 'extension'] },
  { name: 'TextureCoordinateTest', label: 'Texture Coordinate Test', bytes: 14232, tags: ['core', 'testing'] },
  { name: 'TextureEncodingTest', label: 'Texture Encoding Test', bytes: 21612, tags: ['core', 'testing'] },
  { name: 'TextureLinearInterpolationTest', label: 'Texture Linear Interpolation Test', bytes: 13468, tags: ['core', 'testing'] },
  { name: 'TextureSettingsTest', label: 'Texture Settings Test', bytes: 42840, tags: ['core', 'testing'] },
  { name: 'TextureTransformMultiTest', label: 'Texture Transform Multi Test', bytes: 388264, tags: ['testing', 'extension'] },
  { name: 'TransmissionRoughnessTest', label: 'Transmission Roughness Test', bytes: 393808, tags: ['testing', 'extension'] },
  { name: 'TransmissionTest', label: 'Transmission Test', bytes: 1473792, tags: ['testing', 'extension'] },
  { name: 'TransmissionThinwallTestGrid', label: 'TransmissionThinwallTestGrid', bytes: 1188724, tags: ['extension'] },
  { name: 'Unicode❤♻Test', label: 'Unicode❤♻Test', bytes: 5488, tags: ['core', 'testing'] },
  { name: 'UnlitTest', label: 'Unlit Test', bytes: 3992, tags: ['testing', 'extension'] },
  { name: 'USDShaderBallForGltf', label: 'USD Shader Ball for glTF', bytes: 1319652, tags: ['showcase', 'extension'] },
  { name: 'VertexColorTest', label: 'Vertex Color Test', bytes: 26220, tags: ['core', 'testing'] },
] as const satisfies readonly KitchenSinkAsset[];

// Classifier result for iPad A10+/Safari 17+ and Quest 2 targets.
const inherentlySlowKitchenSinkAssetNames = new Set<string>([
  'AlphaBlendModeTest',
  'ClearcoatWicker',
  'CompareBaseColor',
  'CompareSpecular',
  'GlassBrokenWindow',
  'MetalRoughSpheresNoTextures',
  'MorphStressTest',
  'NormalTangentTest',
  'RecursiveSkeletons',
  'TransmissionTest',
  'TransmissionThinwallTestGrid',
  'USDShaderBallForGltf',
]);

const assetScaleOverrides: Readonly<Record<string, number>> = {
  AlphaBlendModeTest: 0.34,
  CesiumMan: 0.34,
  CesiumMilkTruck: 0.3,
  ClearcoatWicker: 0.34,
  CompareBaseColor: 0.34,
  CompareSheen: 0.34,
  CompareSpecular: 0.34,
  Duck: 0.74,
  Fox: 0.44,
  GlassBrokenWindow: 0.34,
  MetalRoughSpheresNoTextures: 0.32,
  MorphStressTest: 0.36,
  MultiUVTest: 0.48,
  NormalTangentTest: 0.28,
  RecursiveSkeletons: 0.34,
  SunglassesKhronos: 0.38,
  TransmissionTest: 0.34,
  TransmissionThinwallTestGrid: 0.32,
  USDShaderBallForGltf: 0.32,
};

const assetHasTag = (
  tags: readonly KitchenSinkTag[],
  tag: KitchenSinkTag,
): boolean => tags.includes(tag);

const assetsForKitchenSinkSet = (set: KitchenSinkSet): readonly KitchenSinkAsset[] =>
  khronosKitchenSinkAssets.filter((asset) =>
    set === 'ok'
      ? !inherentlySlowKitchenSinkAssetNames.has(asset.name)
      : inherentlySlowKitchenSinkAssetNames.has(asset.name)
  );

const kitchenSinkSetLabel = {
  ok: 'ok-to-render',
  slow: 'inherently slow',
} as const satisfies Readonly<Record<KitchenSinkSet, string>>;

const columnSpacing = 3.04;
const rowSpacing = 2.34;
const totalFixtureBytes = khronosKitchenSinkAssets
  .reduce((total, asset) => total + asset.bytes, 0);
const totalFixtureMiB = (totalFixtureBytes / 1024 / 1024).toFixed(1);

const createKitchenSinkInstances = (assets: readonly KitchenSinkAsset[]): readonly KitchenSinkInstance[] => {
  const columnCount = assets.length > 24 ? 9 : 5;
  const rowCount = Math.ceil(assets.length / columnCount);
  return assets
    .map((asset, index) => {
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      const scale = assetScaleOverrides[asset.name] ?? (assetHasTag(asset.tags, 'pbrtest') ? 0.36 : 0.44);

      return {
        ...asset,
        position: [
          (column - (columnCount - 1) / 2) * columnSpacing,
          ((rowCount - 1) / 2 - row) * rowSpacing,
          0,
        ],
        rotation: [0, 0.2, 0],
        scale: [scale, scale, scale],
        src: khronosGltf(asset.name),
      };
    });
};

const GltfKitchenSinkScene = ({ set }: { readonly set: KitchenSinkSet }): ReactNode => {
  const selectedAssets = assetsForKitchenSinkSet(set);
  const kitchenSinkAssets = createKitchenSinkInstances(selectedAssets);
  const selectedFixtureBytes = selectedAssets.reduce((total, asset) => total + asset.bytes, 0);
  const selectedFixtureMiB = (selectedFixtureBytes / 1024 / 1024).toFixed(1);
  const orbit = useOrbitCamera({
    distance: selectedAssets.length > 24 ? 29.5 : 16.8,
    far: 120,
    pitch: 0.02,
    target: [0, 0, 0],
    yaw: 0.12,
  });

  return (
    <Canvas
      aria-label={`glTF Kitchen Sink ${kitchenSinkSetLabel[set]} set with ${selectedAssets.length} of ${khronosKitchenSinkAssets.length} official Khronos GLB sample assets, ${selectedFixtureMiB} of ${totalFixtureMiB} MiB total`}
      rootOptions={exampleCanvasRootOptions}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} environment={exampleEnvironment} toneMapping="none">
          <directionalLight color={[0.58, 0.56, 0.52, 1]} direction={[0.36, -0.72, -1]} />
          {kitchenSinkAssets.map((asset) =>
            createElement(
              Fragment,
              { key: asset.name },
              <gltf
                src={asset.src}
                transform={{
                  position: asset.position,
                  rotation: asset.rotation ?? [0, 0, 0],
                  scale: asset.scale,
                }}
              />
            )
          )}
        </pass>
      </scene>
      <BenchmarkRendererSnapshot />
      <OrbitControls {...orbit.orbitControlsProps} maxDistance={60} minDistance={9} />
    </Canvas>
  );
};

export const GltfKitchenSink = (): ReactNode => <GltfKitchenSinkScene set="ok" />;

export const GltfKitchenSinkSlow = (): ReactNode => <GltfKitchenSinkScene set="slow" />;
