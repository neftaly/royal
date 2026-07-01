import {
  boxGeometry,
  type BoxGeometry,
  type MeshNode,
  type PlaneGeometry,
  type StandardMaterial,
  type UnlitMaterial,
  type WireframeMaterial,
} from '@royal/renderer-core';
import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Canvas } from '../src/index';
import { jsx, markRendererComponent } from '../src/jsx-runtime';

describe('Royal JSX runtime', () => {
  it('delegates function components to React JSX by default', () => {
    const scene = jsx('scene', {
      children: jsx('pass', {
        children: jsx('perspectiveCamera', {
          far: 10,
          fovY: 1,
          near: 0.1,
          position: [0, 0, 4],
          rotation: [0, 0, 0],
        }),
      }),
    });

    const element = (jsx as unknown as (
      type: typeof Canvas,
      props: Parameters<typeof Canvas>[0],
    ) => ReactNode)(Canvas, {
      children: scene,
    });

    expect(isValidElement(element)).toBe(true);
    expect(isValidElement(element) ? element.type : undefined).toBe(Canvas);
  });

  it('keeps marked renderer descriptor components on the immediate-call path', () => {
    const DescriptorGeometry = markRendererComponent(
      (): ReturnType<typeof boxGeometry> => boxGeometry([1, 2, 3]),
    );

    expect(jsx(DescriptorGeometry, {})).toEqual({
      kind: 'box',
      size: [1, 2, 3],
    });
  });

  it('does not immediate-call unmarked function components as renderer descriptors', () => {
    const DescriptorGeometry = (): ReturnType<typeof boxGeometry> => boxGeometry([1, 2, 3]);
    const element = jsx(DescriptorGeometry, {});

    expect(isValidElement(element)).toBe(true);
    expect(isValidElement(element) ? element.type : undefined).toBe(DescriptorGeometry);
  });

  it('adapts mesh texture URLs and geometry children', () => {
    const geometry = boxGeometry(2);
    const node = jsx('mesh', {
      children: geometry,
      texture: '/textures/albedo.png',
    }) as MeshNode;

    expect(node.geometry).toBe(geometry);
    expect(node.material.baseColor).toMatchObject({
      colorSpace: 'srgb',
      kind: 'asset',
      uri: '/textures/albedo.png',
    });
  });

  it('creates core geometry and material descriptor intrinsics', () => {
    const box = jsx('boxGeometry', { size: [1, 2, 3] }) as BoxGeometry;
    const plane = jsx('planeGeometry', { size: [4, 5] }) as PlaneGeometry;
    const standard = jsx('standardMaterial', { color: [0.2, 0.4, 0.6, 1] }) as StandardMaterial;
    const unlit = jsx('unlitMaterial', { color: [0.7, 0.8, 0.9, 1] }) as UnlitMaterial;
    const wireframe = jsx('wireframeMaterial', {
      color: [1, 1, 1, 1],
      width: 2,
    }) as WireframeMaterial;

    expect(box).toEqual({
      kind: 'box',
      size: [1, 2, 3],
    });
    expect(plane).toEqual({
      kind: 'plane',
      size: [4, 5],
    });
    expect(standard).toMatchObject({
      baseColor: {
        color: [0.2, 0.4, 0.6, 1],
        kind: 'solid',
      },
      kind: 'standard',
    });
    expect(unlit).toMatchObject({
      baseColor: {
        color: [0.7, 0.8, 0.9, 1],
        kind: 'solid',
      },
      kind: 'unlit',
    });
    expect(wireframe).toMatchObject({
      baseColor: {
        color: [1, 1, 1, 1],
        kind: 'solid',
      },
      kind: 'wireframe',
      width: 2,
    });
  });

  it('accepts geometry and material descriptor children under mesh', () => {
    const geometry = jsx('planeGeometry', { size: [2, 3] });
    const material = jsx('unlitMaterial', { color: [0.1, 0.2, 0.3, 1] });
    const node = jsx('mesh', {
      children: [geometry, material],
    }) as MeshNode;

    expect(node.geometry).toBe(geometry);
    expect(node.material).toBe(material);
  });

  it('rejects competing mesh material sources', () => {
    const geometry = jsx('boxGeometry', { size: 1 });
    const material = jsx('unlitMaterial', { color: [0.1, 0.2, 0.3, 1] });

    expect(() => jsx('mesh', {
      children: [geometry, material],
      color: [1, 1, 1, 1],
    })).toThrow('mesh expects only one material source');
  });

  it('rejects unknown kind objects as mesh geometry children', () => {
    expect(() => jsx('mesh', {
      children: {
        kind: 'custom-surface',
      },
      color: [1, 1, 1, 1],
    })).toThrow('mesh children must be geometry or material descriptors; received kind "custom-surface"');
  });
});
