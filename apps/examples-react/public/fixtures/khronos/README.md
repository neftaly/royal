# Khronos glTF Sample Assets fixtures

Official KhronosGroup/glTF-Sample-Assets models copied from raw GitHub URLs. Supported fixtures are used by the manifest-driven glTF Lab; unsupported fixtures remain as a pinned compatibility corpus.

Upstream repository: https://github.com/KhronosGroup/glTF-Sample-Assets
Model index inspected: https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/model-index.json

## Selection policy

- Prefer the official `glTF-Binary` variant when present.
- Keep the route broad but bounded: most selected assets are 1.5 MB or smaller; a few already-used visual regression fixtures above that limit are retained.
- Avoid generated fixtures and avoid non-Khronos sources.
- Skip samples whose primary value depends on renderer features not currently implemented here, or whose size would make the example route and repository unnecessarily heavy.

`src/examples/gltf-lab-manifest.json` is the single generated/static inventory.
It records local paths, byte sizes, hashes, provenance, structural feature tags,
and retained fixtures whose parsed GLB structure requires deformation. Those
fixtures are deliberately absent from success sweeps until that optional runtime
returns.

## Included set

Included models: 62
Included GLB bytes: 22812656 (21.76 MiB)

Each included model stores:

- `<Model>/README.upstream.md` from `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/<Model>/README.md`
- `<Model>/glTF-Binary/<Model>.glb` from `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/<Model>/glTF-Binary/<Model>.glb`

The shared Khronos legal mark reference is preserved in `LICENSES/LicenseRef-LegalMark-Khronos.txt` from https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/LICENSES/LicenseRef-LegalMark-Khronos.txt

| Model | GLB bytes | Tags |
| --- | ---: | --- |
| AlphaBlendModeTest | 2978812 | core, testing |
| AnimatedMorphCube | 6752 | core, testing |
| AttenuationTest | 57532 | testing, extension |
| Box | 1664 | core, testing |
| BoxAnimated | 11944 | core, testing |
| BoxInterleaved | 1632 | core, testing |
| BoxTextured | 5956 | core, issues, testing |
| BoxTexturedNonPowerOfTwo | 4696 | core, issues, testing |
| BoxVertexColors | 1924 | core, testing |
| CesiumMan | 438044 | core, issues, testing |
| CesiumMilkTruck | 369980 | core, issues, testing |
| ClearCoatCarPaint | 116948 | extension, testing |
| ClearCoatTest | 258048 | testing, extension |
| ClearcoatWicker | 1299752 | extension, testing |
| CompareBaseColor | 1507816 | core, testing, pbrtest |
| CompareClearcoat | 193920 | extension, testing, pbrtest |
| CompareDispersion | 60432 | extension, testing, pbrtest |
| CompareEmissiveStrength | 111796 | extension, testing, pbrtest |
| CompareIor | 213104 | extension, testing, pbrtest |
| CompareIridescence | 214756 | extension, testing, pbrtest |
| CompareMetallic | 172180 | core, testing, pbrtest |
| CompareNormal | 220900 | core, testing, pbrtest |
| CompareRoughness | 155660 | core, testing, pbrtest |
| CompareSheen | 883968 | extension, testing, pbrtest |
| CompareSpecular | 1408364 | extension, testing, pbrtest |
| CompareTransmission | 357024 | extension, testing, pbrtest |
| CompareVolume | 399760 | extension, testing, pbrtest |
| CubeVisibility | 3284 | testing |
| DirectionalLight | 453520 | core, testing |
| Duck | 120484 | core, testing |
| EmissiveStrengthTest | 10668 | testing, extension |
| Fox | 162852 | core, testing |
| GlassBrokenWindow | 1076624 | video, extension |
| InterpolationTest | 7952 | core, testing |
| IridescenceSuzanne | 507608 | testing, extension |
| LightVisibility | 2940 | testing |
| MetalRoughSpheresNoTextures | 291316 | core, testing |
| MorphPrimitivesTest | 53656 | core, testing |
| MorphStressTest | 575900 | core, testing |
| MultiUVTest | 43004 | core, testing |
| NegativeScaleTest | 62568 | core, testing |
| NormalTangentTest | 1796996 | core, testing |
| OrientationTest | 38920 | core, testing |
| PointLightIntensityTest | 30148 | extension, testing |
| RecursiveSkeletons | 561620 | core, testing, issues |
| RiggedFigure | 50116 | core, testing |
| RiggedSimple | 15104 | core, testing |
| SimpleInstancing | 7356 | extension, testing |
| SpecularTest | 223376 | core, testing, extension |
| SunglassesKhronos | 371188 | showcase, extension |
| TextureCoordinateTest | 14232 | core, testing |
| TextureEncodingTest | 21612 | core, testing |
| TextureLinearInterpolationTest | 13468 | core, testing |
| TextureSettingsTest | 42840 | core, testing |
| TextureTransformMultiTest | 388264 | testing, extension |
| TransmissionRoughnessTest | 393808 | testing, extension |
| TransmissionTest | 1473792 | testing, extension |
| TransmissionThinwallTestGrid | 1188724 | extension |
| Unicode❤♻Test | 5488 | core, testing |
| UnlitTest | 3992 | testing, extension |
| USDShaderBallForGltf | 1319652 | showcase, extension |
| VertexColorTest | 26220 | core, testing |

## Skipped official samples

No `glTF-Binary` variant in the official index: AnimatedCube, AnimatedTriangle, BoomBoxWithAxes, Box With Spaces, Cameras, Cube, EnvironmentTest, FlightHelmet, IridescenceDielectricSpheres, IridescenceMetallicSpheres, MandarinOrange, MeshoptCubeTest, MeshPrimitiveModes, MultipleScenes, PrimitiveModeNormalsTest, SciFiHelmet, SheenCloth, SimpleMaterial, SimpleMeshes, SimpleMorph, SimpleSkin, SimpleSparseAccessor, SimpleTexture, Sponza, StainedGlassLamp, Suzanne, TextureTransformTest, Triangle, TriangleWithoutIndices, TwoSidedPlane.

Skipped for renderer compatibility or low Kitchen Sink signal: AnimatedColorsCube (KHR_animation_pointer), AnisotropyDiscTest, AnisotropyRotationTest, AnisotropyStrengthTest, CarbonFibre, CompareAnisotropy (KHR_materials_anisotropy), DiffuseTransmissionTest (KHR_materials_diffuse_transmission), XmpMetadataRoundedCube (non-rendering metadata test).

Skipped primarily for size, route load, or redundancy with smaller selected coverage: ABeautifulGame, AnimationPointerUVs, AnisotropyBarnLamp, AntiqueCamera, Avocado, BarramundiFish, BoomBox, BrainStem, CarConcept, ChairDamaskPurplegold, ChronographWatch, CommercialRefrigerator, CompareAlphaCoverage, CompareAmbientOcclusion, Corset, DamagedHelmet, DiffuseTransmissionPlant, DiffuseTransmissionTeacup, DispersionTest, DragonAttenuation, DragonDispersion, GlamVelvetSofa, GlassHurricaneCandleHolder, GlassVaseFlowers, IORTestGrid, IridescenceAbalone, IridescenceLamp, IridescentDishWithOlives, Lantern, LightsPunctualLamp, MaterialsVariantsShoe, MetalRoughSpheres, MosquitoInAmber, NodePerformanceTest, NormalTangentMirrorTest, PlaysetLightTest, PotOfCoals, PotOfCoalsAnimationPointer, ScatteringSkull, SheenChair, SheenTestGrid, SheenWoodLeatherSofa, SpecGlossVsMetalRough, SpecularSilkPouf, ToyCar, TransmissionOrderTest, VirtualCity, WaterBottle.

The skipped lists are derived from the official `Models/model-index.json` in the upstream repository. Revisit this manifest when the renderer adds material support for anisotropy, diffuse transmission, spec-gloss, or animation pointer, or when the route is split so larger showcase assets can load on demand.
