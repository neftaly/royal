import {
  boxGeometry,
  gltf,
  imageTexture,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  standardMaterial,
  type RenderNode,
  type RenderPass,
  type RenderRoot
} from '@royal/renderer-core';
import { jsx } from '@royal/react/jsx-runtime';
import { describe, expect, it } from 'vitest';

const camera = perspectiveCamera({
  position: [0, 0, 1],
  rotation: [0, 0, 0],
  fovY: Math.PI / 4,
  near: 0.1,
  far: 100
});

const cube = boxGeometry({ size: [1, 1, 1] });
const red = standardMaterial({ color: [1, 0, 0, 1] });

describe('render pass clearColor', () => {
  it('defaults to transparent black', () => {
    expect(pass({ camera, children: [] }).clearColor).toEqual([0, 0, 0, 0]);
  });

  it('keeps explicit colors through the JSX runtime', () => {
    const renderPass = jsx('pass', {
      camera,
      clearColor: [0.1, 0.2, 0.3, 1],
      children: []
    }) as RenderPass;

    expect(renderPass.kind).toBe('pass');
    expect(renderPass.clearColor).toEqual([0.1, 0.2, 0.3, 1]);
  });

  it('accepts one JSX camera child', () => {
    const cameraChild = jsx('perspectiveCamera', {
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      fovY: Math.PI / 4,
      near: 0.1,
      far: 100
    });

    const renderPass = jsx('pass', {
      children: cameraChild
    }) as RenderPass;

    expect(renderPass.camera).toEqual(camera);
  });

  it('accepts one JSX orthographic camera child', () => {
    const cameraChild = jsx('orthographicCamera', {
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      left: -2,
      right: 2,
      bottom: -1,
      top: 1,
      near: 0.1,
      far: 100
    });

    const renderPass = jsx('pass', {
      children: cameraChild
    }) as RenderPass;

    expect(renderPass.camera.kind).toBe('orthographic-camera');
    expect(renderPass.camera).toEqual(orthographicCamera({
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      left: -2,
      right: 2,
      bottom: -1,
      top: 1,
      near: 0.1,
      far: 100
    }));
  });

  it('accepts JSX text as a render node child', () => {
    const textChild = jsx('text', {
      color: [1, 1, 1, 1],
      fontSize: 0.25,
      origin: [-1, 0, 0],
      text: 'Open fullscreen'
    });

    const renderPass = jsx('pass', {
      camera,
      children: textChild
    }) as RenderPass;

    expect(renderPass.children).toHaveLength(1);
    expect(renderPass.children[0]?.kind).toBe('text');
  });

  it('reads JSX text children and defaults missing text to empty text', () => {
    const textFromChildren = jsx('text', {
      color: [1, 1, 1, 1],
      children: ['Open', ' ', 'fullscreen']
    }) as RenderNode;
    const emptyText = jsx('text', {
      color: [1, 1, 1, 1]
    }) as RenderNode;

    expect(textFromChildren).toMatchObject({
      kind: 'text',
      layout: { source: 'Open fullscreen' }
    });
    expect(emptyText).toMatchObject({
      kind: 'text',
      layout: { source: '' }
    });
  });

  it('accepts JSX glTF src as a render node child', () => {
    const gltfChild = jsx('gltf', {
      src: '/DamagedHelmet/DamagedHelmet.gltf',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1.5, 1.5, 1.5]
      }
    }) as RenderNode;

    const renderPass = jsx('pass', {
      camera,
      children: gltfChild
    }) as RenderPass;

    expect(renderPass.children).toHaveLength(1);
    expect(renderPass.children[0]).toMatchObject({
      asset: {
        id: '/DamagedHelmet/DamagedHelmet.gltf',
        uri: '/DamagedHelmet/DamagedHelmet.gltf'
      },
      kind: 'gltf',
      transform: {
        scale: [1.5, 1.5, 1.5]
      }
    });
  });

  it('ignores empty JSX conditional children under passes', () => {
    const meshChild = jsx('mesh', {
      geometry: cube,
      material: red
    });

    const renderPass = jsx('pass', {
      camera,
      children: [null, undefined, false, true, '\n  ', meshChild]
    }) as RenderPass;

    expect(renderPass.children).toEqual([meshChild]);
  });

  it('lowers JSX mesh texture props to a standard material', () => {
    const albedo = imageTexture('/textures/albedo.png');
    const meshChild = jsx('mesh', {
      texture: albedo,
      geometry: cube
    }) as RenderNode;

    expect(meshChild).toMatchObject({
      kind: 'mesh',
      material: {
        baseColor: albedo,
        kind: 'standard'
      }
    });
  });

  it('lowers JSX mesh color props to solid textures', () => {
    const meshChild = jsx('mesh', {
      color: [0.1, 0.2, 0.3, 1],
      geometry: cube
    }) as RenderNode;

    expect(meshChild).toMatchObject({
      kind: 'mesh',
      material: {
        baseColor: {
          color: [0.1, 0.2, 0.3, 1],
          kind: 'solid'
        },
        kind: 'standard'
      }
    });
  });

  it('uses material, texture, color precedence for JSX mesh sugar', () => {
    const albedo = imageTexture('/textures/albedo.png');
    const materialMesh = jsx('mesh', {
      color: [0.1, 0.2, 0.3, 1],
      geometry: cube,
      material: red,
      texture: albedo
    }) as RenderNode;
    const textureMesh = jsx('mesh', {
      color: [0.1, 0.2, 0.3, 1],
      geometry: cube,
      texture: albedo
    }) as RenderNode;

    expect(materialMesh).toMatchObject({
      kind: 'mesh',
      material: red
    });
    expect(textureMesh).toMatchObject({
      kind: 'mesh',
      material: {
        baseColor: albedo,
        kind: 'standard'
      }
    });
  });

  it('ignores empty JSX conditional children under scenes', () => {
    const renderPass = pass({ camera, children: [] });
    const root = jsx('scene', {
      children: [null, undefined, false, true, '\n  ', renderPass]
    }) as RenderRoot;

    expect(root.children).toEqual([renderPass]);
  });

  it('rejects missing JSX cameras', () => {
    expect(() => jsx('pass', { children: [] })).toThrow('pass expects exactly one camera');
  });

  it('rejects ambiguous JSX cameras', () => {
    const cameraChild = jsx('perspectiveCamera', {
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      fovY: Math.PI / 4,
      near: 0.1,
      far: 100
    });

    expect(() => jsx('pass', {
      camera,
      children: cameraChild
    })).toThrow('pass expects exactly one camera');
  });

  it('rejects multiple JSX camera children', () => {
    const cameraChild = jsx('perspectiveCamera', {
      position: [0, 0, 1],
      rotation: [0, 0, 0],
      fovY: Math.PI / 4,
      near: 0.1,
      far: 100
    });

    expect(() => jsx('pass', {
      children: [cameraChild, cameraChild]
    })).toThrow('pass expects exactly one camera');
  });
});

describe('transform inputs', () => {
  it('defaults mesh scale to identity', () => {
    expect(mesh({
      geometry: cube,
      material: red,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
    }).transform).toEqual({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    });
  });

  it('keeps explicit glTF scale', () => {
    expect(gltf({
      src: '/DamagedHelmet/DamagedHelmet.gltf',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [2, 2, 2]
      }
    }).transform?.scale).toEqual([2, 2, 2]);
  });
});
