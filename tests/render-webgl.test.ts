import {
  boxGeometry,
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  solidTexture,
  standardMaterial,
  unlitMaterial,
  text
} from '@royal/renderer-core';
import { createRoot } from '@royal/react';
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
const redTexture = solidTexture({ color: [1, 0, 0, 1] });
const material = standardMaterial({ baseColor: redTexture });
const unlit = unlitMaterial({ baseColor: redTexture });
const light = directionalLight({ direction: [1, -2, -1], color: [1, 1, 1, 1] });
const triangleAsset = {
  id: 'triangle',
  uri: 'https://example.test/triangle.gltf'
};
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

  it('caches geometry buffers and releases them on dispose', () => {
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));

    root.render(renderScene);
    root.render(renderScene);

    expect(counts.createBuffer).toBe(3);
    expect(counts.deleteBuffer).toBe(0);

    root.dispose();

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

    root.dispose();
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

  it('skips draw submission for orthographic meshes outside the frustum', () => {
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
            mesh({ geometry: cube, material: unlit }),
            mesh({
              geometry: cube,
              material: unlit,
              transform: {
                position: [20, 0, 0],
                rotation: [0, 0, 0]
              }
            })
          ]
        })
      ]
    }));

    expect(counts.drawElements).toBe(1);
  });

  it('renders text without uploading text textures', () => {
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
            text({
              color: [1, 1, 1, 1],
              text: 'a'
            })
          ]
        })
      ]
    }));

    expect(counts.drawElements).toBe(1);
    expect(counts.createTexture).toBe(0);
    expect(counts.texImage2D).toBe(0);

    root.dispose();

    expect(counts.deleteTexture).toBe(0);
  });

  it('releases replaced dynamic text buffers before dispose', () => {
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));
    const textScene = (content: string) => scene({
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
            text({
              color: [1, 1, 1, 1],
              text: content
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

    root.dispose();

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

  it('releases glTF buffers and textures on dispose', async () => {
    installGltfFixture();
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));
    const renderGltfScene = scene({
      children: [
        pass({
          camera,
          children: [
            light,
            gltf({ asset: triangleAsset })
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

    root.dispose();

    expect(counts.deleteBuffer).toBe(counts.createBuffer);
    expect(counts.deleteTexture).toBe(counts.createTexture);
  });

  it('skips draw submission for loaded glTF assets outside the frustum', async () => {
    installGltfFixture();
    const { counts, gl } = fakeGl();
    const root = createRoot(fakeCanvas(gl));
    const renderGltfScene = scene({
      children: [
        pass({
          camera,
          children: [
            light,
            gltf({
              asset: triangleAsset,
              transform: {
                position: [1000, 0, 0],
                rotation: [0, 0, 0]
              }
            })
          ]
        })
      ]
    });

    root.render(renderGltfScene);
    await waitFor(() => counts.createBuffer > 0);
    root.render(renderGltfScene);

    expect(counts.drawElements).toBe(0);

    root.dispose();
  });

  it('releases a late glTF texture if disposed before image decode finishes', async () => {
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
            gltf({ asset: triangleAsset })
          ]
        })
      ]
    });

    root.render(renderGltfScene);
    await waitFor(() => counts.drawElements > 0);
    root.dispose();

    const deletedBeforeLateTexture = counts.deleteTexture;
    resolveBitmap?.({} as ImageBitmap);
    await waitFor(() => counts.deleteTexture > deletedBeforeLateTexture);

    expect(counts.deleteBuffer).toBe(counts.createBuffer);
    expect(counts.deleteTexture).toBe(counts.createTexture);
  });
});
