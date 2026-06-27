import {
  boxGeometry,
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  unlitMaterial,
  vectorText
} from '@royal/renderer-core';
import { createRoot } from '@royal/react';
import { orthographic } from '../packages/react-royal-fiber/src/webgl/matrix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeCanvas,
  fakeGl,
  installGltfFixture,
  waitFor
} from './webgl-test-utils';

const camera = perspectiveCamera({
  position: [0, 0, 5],
  rotation: [0, 0, 0],
  fovY: Math.PI / 4,
  near: 0.1,
  far: 1000
});
const cube = boxGeometry({ size: [1, 1, 1] });
const material = standardMaterial({ color: [1, 0, 0, 1] });
const unlit = unlitMaterial({ color: [1, 0, 0, 1] });
const light = directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] });
const renderScene = scene({
  children: [
    pass({
      camera,
      children: [
        light,
        mesh({ geometry: cube, material })
      ]
    })
  ]
});

describe('WebGL resource lifetime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches geometry buffers and releases them on unmount', () => {
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));

    root.render(renderScene);
    root.render(renderScene);

    expect(counts.createBuffer).toBe(3);
    expect(counts.deleteBuffer).toBe(0);

    root.unmount();

    expect(counts.deleteBuffer).toBe(3);
  });

  it('rerenders imperative roots after a DPR-only change', () => {
    const { counts, gl } = fakeGl();
    const mediaListeners = new Set<EventListenerOrEventListenerObject>();
    const frameCallbacks: FrameRequestCallback[] = [];
    const canvas = {
      height: 1,
      width: 1,
      getBoundingClientRect: () => ({ height: 50, width: 100 }),
      getContext: () => gl
    } as unknown as HTMLCanvasElement;

    vi.stubGlobal('ResizeObserver', undefined);
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal('matchMedia', vi.fn((media: string): MediaQueryList => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: (_type: 'change', listener: EventListenerOrEventListenerObject) => {
        mediaListeners.add(listener);
      },
      removeEventListener: (_type: 'change', listener: EventListenerOrEventListenerObject) => {
        mediaListeners.delete(listener);
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));

    const root = createRoot(canvas);
    root.render(renderScene);

    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
    expect(counts.drawElements).toBe(1);

    vi.stubGlobal('devicePixelRatio', 2);
    for (const listener of Array.from(mediaListeners)) {
      if (typeof listener === 'function') listener({} as MediaQueryListEvent);
      else listener.handleEvent({} as MediaQueryListEvent);
    }
    expect(frameCallbacks).toHaveLength(1);
    frameCallbacks.shift()?.(0);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(counts.drawElements).toBe(2);

    root.unmount();
  });

  it('renders unlit orthographic meshes without a light', () => {
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));

    root.render(scene({
      children: [
        pass({
          camera: orthographicCamera({
            position: [0, 0, 5],
            rotation: [0, 0, 0],
            left: -2,
            right: 2,
            bottom: -1,
            top: 1,
            near: 0.1,
            far: 100
          }),
          children: [
            mesh({ geometry: cube, material: unlit })
          ]
        })
      ]
    }));

    expect(counts.drawElements).toBe(1);
  });

  it('renders vector text without uploading text textures', () => {
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));

    root.render(scene({
      children: [
        pass({
          camera: orthographicCamera({
            position: [0, 0, 5],
            rotation: [0, 0, 0],
            left: -2,
            right: 2,
            bottom: -1,
            top: 1,
            near: 0.1,
            far: 100
          }),
          children: [
            vectorText({
              color: [1, 1, 1, 1],
              glyphs: [{
                center: [0, 0, 0],
                char: 'a',
                span: 1
              }]
            })
          ]
        })
      ]
    }));

    expect(counts.drawElements).toBe(1);
    expect(counts.createTexture).toBe(0);
    expect(counts.texImage2D).toBe(0);

    root.unmount();

    expect(counts.deleteTexture).toBe(0);
  });

  it('releases replaced dynamic vector text buffers before unmount', () => {
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));
    const textScene = (text: string) => scene({
      children: [
        pass({
          camera: orthographicCamera({
            position: [0, 0, 5],
            rotation: [0, 0, 0],
            left: -2,
            right: 2,
            bottom: -1,
            top: 1,
            near: 0.1,
            far: 100
          }),
          children: [
            vectorText({
              color: [1, 1, 1, 1],
              text
            })
          ]
        })
      ]
    });

    root.render(textScene('first'));

    expect(counts.createBuffer).toBe(3);
    expect(counts.deleteBuffer).toBe(0);

    root.render(textScene('second'));

    expect(counts.createBuffer).toBe(6);
    expect(counts.deleteBuffer).toBe(3);

    root.unmount();

    expect(counts.deleteBuffer).toBe(6);
  });

  it('keeps standard meshes lit explicitly', () => {
    const { gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));

    expect(() => root.render(scene({
      children: [
        pass({
          camera,
          children: [
            mesh({ geometry: cube, material })
          ]
        })
      ]
    }))).toThrow('StandardMaterial box mesh requires a directionalLight');
  });

  it('builds an orthographic projection matrix', () => {
    const matrix = orthographic(-2, 2, -1, 1, 0.1, 10);

    expect(matrix[0]).toBeCloseTo(0.5);
    expect(matrix[5]).toBeCloseTo(1);
    expect(matrix[10]).toBeCloseTo(-2 / 9.9);
    expect(matrix[12]).toBeCloseTo(0);
    expect(matrix[13]).toBeCloseTo(0);
    expect(matrix[14]).toBeCloseTo(-10.1 / 9.9);
  });

  it('releases glTF buffers and textures on unmount', async () => {
    installGltfFixture();
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));
    const renderGltfScene = scene({
      children: [
        pass({
          camera,
          children: [
            light,
            gltf({ src: 'https://example.test/triangle.gltf' })
          ]
        })
      ]
    });

    root.render(renderGltfScene);
    await waitFor(() => counts.drawElements > 0);
    root.render(renderGltfScene);

    expect(counts.createBuffer).toBeGreaterThan(0);
    expect(counts.createTexture).toBeGreaterThan(0);
    expect(counts.deleteBuffer).toBe(0);
    expect(counts.deleteTexture).toBe(0);

    root.unmount();

    expect(counts.deleteBuffer).toBe(counts.createBuffer);
    expect(counts.deleteTexture).toBe(counts.createTexture);
  });

  it('releases a late glTF texture if unmounted before image decode finishes', async () => {
    let resolveBitmap: ((image: ImageBitmap) => void) | undefined;
    installGltfFixture({
      createImageBitmap: () => new Promise((resolve) => {
        resolveBitmap = resolve;
      })
    });
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));
    const renderGltfScene = scene({
      children: [
        pass({
          camera,
          children: [
            light,
            gltf({ src: 'https://example.test/triangle.gltf' })
          ]
        })
      ]
    });

    root.render(renderGltfScene);
    await waitFor(() => counts.drawElements > 0);
    root.unmount();

    const deletedBeforeLateTexture = counts.deleteTexture;
    resolveBitmap?.({} as ImageBitmap);
    await waitFor(() => counts.deleteTexture > deletedBeforeLateTexture);

    expect(counts.deleteBuffer).toBe(counts.createBuffer);
    expect(counts.deleteTexture).toBe(counts.createTexture);
  });
});
