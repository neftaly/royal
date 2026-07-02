/** @jsxImportSource @royal/react */
import {
  Canvas,
  OrbitControls,
  useOrbitCamera,
} from '@royal/react';
import { type ReactNode } from 'react';
import { exampleRenderer } from '../rendering';

const fixtureBase = import.meta.env.BASE_URL + 'fixtures/gltf-lod/';
const materialLodSrc = fixtureBase + 'LevelOfDetail/LevelOfDetail.glb';
const nodeLodSrc = fixtureBase + 'MSFT_lod_test/MSFT_lod_test.gltf';
const hierarchyLodSrc = fixtureBase + 'MSFT_lod_complex_hierarchy/MSFT_lod_complex_hierarchy.gltf';

export const GltfLod = (): ReactNode => {
  const orbit = useOrbitCamera({
    distance: 6.8,
    pitch: 0.04,
  });

  return (
    <Canvas
      aria-label="glTF MSFT_lod"
      renderer={exampleRenderer}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <scene>
        <pass camera={orbit.camera} clearColor={[0.035, 0.042, 0.052, 1]}>
          <directionalLight color={[1.22, 1.16, 1.05, 1]} direction={[-0.42, -0.5, -1]} />
          <text
            color={[0.82, 0.9, 0.92, 1]}
            fontSize={0.14}
            lineHeight={0.18}
            origin={[-3.05, -1.24, 0.35]}
          >
            material LOD
          </text>
          <text
            color={[0.82, 0.9, 0.92, 1]}
            fontSize={0.14}
            lineHeight={0.18}
            origin={[-0.58, -1.24, 0.35]}
          >
            node LOD
          </text>
          <text
            color={[0.82, 0.9, 0.92, 1]}
            fontSize={0.14}
            lineHeight={0.18}
            origin={[1.78, -1.24, 0.35]}
          >
            hierarchy LOD
          </text>
          <model
            src={materialLodSrc}
            transform={{
              position: [-2.55, 0.15, 0],
              rotation: [0.12, -0.2, 0],
              scale: [1.8, 1.8, 1.8],
            }}
          />
          <model
            src={nodeLodSrc}
            transform={{
              position: [0, 0.02, 0],
              rotation: [0.1, -0.35, 0],
              scale: [0.82, 0.82, 0.82],
            }}
          />
          <model
            src={hierarchyLodSrc}
            transform={{
              position: [2.55, 0, 0],
              rotation: [0.12, -0.45, 0],
              scale: [0.72, 0.72, 0.72],
            }}
          />
        </pass>
      </scene>
      <OrbitControls {...orbit.controls} />
    </Canvas>
  );
};
