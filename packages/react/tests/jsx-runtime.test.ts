import { boxGeometry, type MeshNode, type RenderRoot } from '@royal/renderer-core';
import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Canvas } from '../src/index';
import { jsx } from '../src/jsx-runtime';

describe('Royal JSX runtime', () => {
  it('delegates marked React-owned components to React JSX', () => {
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
    }) as RenderRoot;

    const element = (jsx as unknown as (
      type: typeof Canvas,
      props: Parameters<typeof Canvas>[0],
    ) => ReactNode)(Canvas, {
      children: scene,
    });

    expect(isValidElement(element)).toBe(true);
    expect(isValidElement(element) ? element.type : undefined).toBe(Canvas);
  });

  it('keeps descriptor function components on the immediate-call path', () => {
    const DescriptorGeometry = (): ReturnType<typeof boxGeometry> => boxGeometry([1, 2, 3]);

    expect(jsx(DescriptorGeometry, {})).toEqual({
      kind: 'box',
      size: [1, 2, 3],
    });
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
});
