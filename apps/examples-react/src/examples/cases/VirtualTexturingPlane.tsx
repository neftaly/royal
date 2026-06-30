/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  solidTexture,
  textureAsset,
  unlitMaterial,
  type UnlitMaterial,
  type RenderRoot,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import {
  createElement,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';

type SurfaceView = {
  readonly offset: readonly [number, number];
  readonly rotation: readonly [number, number];
  readonly zoom: number;
};

type DragMode = 'pan' | 'rotate';

type DragState = {
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly startOffset: readonly [number, number];
  readonly startRotation: readonly [number, number];
  readonly startX: number;
  readonly startY: number;
};

const surfaceGeometry = boxGeometry({ size: [5.2, 3.4, 0.05] });
const defaultView: SurfaceView = {
  offset: [0, -0.04],
  rotation: [0.66, -0.44],
  zoom: 5.9,
};
const minCameraZ = 2.25;
const maxCameraZ = 6.35;
const minPitch = -0.95;
const maxPitch = 0.95;
const minYaw = -1.1;
const maxYaw = 1.1;
const fallbackTexture = solidTexture({
  color: [0.1, 0.13, 0.16, 1],
  id: 'generated-virtual-texturing-fallback',
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampRotation = (
  [pitch, yaw]: readonly [number, number],
): readonly [number, number] => [
  clamp(pitch, minPitch, maxPitch),
  clamp(yaw, minYaw, maxYaw),
];

const clampOffset = (
  [x, y]: readonly [number, number],
  zoom: number,
): readonly [number, number] => {
  const nearAmount = (maxCameraZ - zoom) / (maxCameraZ - minCameraZ);
  const maxX = 0.16 + nearAmount * 1.42;
  const maxY = 0.1 + nearAmount * 0.92;

  return [clamp(x, -maxX, maxX), clamp(y, -maxY, maxY)];
};

const createGeneratedTextureUri = (): string => {
  const size = 2048;
  const coarsePalette = [
    '#0d2b3a',
    '#12485a',
    '#17636b',
    '#254466',
    '#1f6f82',
    '#183247',
  ] as const;
  const detailPalette = [
    '#ffe06b',
    '#ff9a45',
    '#f15f50',
    '#fff4d4',
    '#ef476f',
  ] as const;
  const canvas = document.createElementNS(
    'http://www.w3.org/1999/xhtml',
    'canvas',
  ) as HTMLCanvasElement;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) return '';

  context.imageSmoothingEnabled = false;
  const base = context.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#071824');
  base.addColorStop(0.54, '#123f55');
  base.addColorStop(1, '#091d2a');
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const x = column * 256;
      const y = row * 256;

      context.fillStyle =
        coarsePalette[(column * 5 + row * 3) % coarsePalette.length] ?? coarsePalette[0];
      context.globalAlpha = 0.54;
      context.fillRect(x, y, 256, 256);
      context.globalAlpha = 1;
      context.fillStyle =
        (column + row) % 2 === 0
          ? 'rgba(124, 198, 204, 0.18)'
          : 'rgba(5, 16, 25, 0.2)';
      context.fillRect(x + 18, y + 18, 220, 220);
    }
  }

  for (let index = 0; index < 1900; index += 1) {
    const x = (index * 89) % size;
    const y = (index * 233) % size;
    const mark = 1 + (index % 5);

    context.fillStyle =
      detailPalette[(index * 11) % detailPalette.length] ?? detailPalette[0];
    context.globalAlpha = 0.26;
    context.fillRect(x, y, mark, 2 + (index % 5));
  }
  context.globalAlpha = 1;

  const drawGrid = (step: number, lineWidth: number, color: string): void => {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    for (let offset = 0; offset <= size; offset += step) {
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset, size);
      context.moveTo(0, offset);
      context.lineTo(size, offset);
      context.stroke();
    }
  };

  const drawMicroPatch = (left: number, top: number, patchSize: number, phase: number): void => {
    context.save();
    context.beginPath();
    context.rect(left, top, patchSize, patchSize);
    context.clip();
    context.fillStyle = '#170f12';
    context.fillRect(left, top, patchSize, patchSize);

    for (let y = 0; y < patchSize; y += 8) {
      for (let x = 0; x < patchSize; x += 8) {
        const filled = (x / 8 + y / 8 + phase) % 2 === 0;
        context.fillStyle = filled
          ? '#fff2c2'
          : detailPalette[(x + y + phase) % detailPalette.length] ?? detailPalette[0];
        context.fillRect(left + x, top + y, 8, 8);
      }
    }

    context.strokeStyle = 'rgba(255, 231, 143, 0.72)';
    context.lineWidth = 1;
    for (let offset = 0; offset <= patchSize; offset += 16) {
      context.beginPath();
      context.moveTo(left + offset, top);
      context.lineTo(left + patchSize - offset * 0.14, top + patchSize);
      context.stroke();
    }

    context.fillStyle = 'rgba(15, 24, 31, 0.78)';
    context.fillRect(left + 18, top + 18, patchSize * 0.44, patchSize * 0.18);
    context.fillStyle = '#fff2c2';
    context.font =
      `700 ${Math.max(24, patchSize * 0.11)}px ui-monospace, ` +
      'SFMono-Regular, Consolas, monospace';
    context.textBaseline = 'top';
    context.fillText(`P${phase + 1}`, left + 30, top + 26);

    context.strokeStyle = '#101820';
    context.lineWidth = 8;
    context.strokeRect(left + 4, top + 4, patchSize - 8, patchSize - 8);
    context.strokeStyle = '#fff2c2';
    context.lineWidth = 2;
    context.strokeRect(left + 16, top + 16, patchSize - 32, patchSize - 32);
    context.restore();
  };

  const center = size / 2;
  for (let radius = 520; radius >= 28; radius -= 28) {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle =
      detailPalette[(radius / 28) % detailPalette.length] ?? detailPalette[0];
    context.lineWidth = radius % 56 === 0 ? 12 : 4;
    context.stroke();
  }

  for (let index = 0; index < 56; index += 1) {
    const angle = index * 0.72;
    const radius = 90 + index * 14;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;

    context.fillStyle = detailPalette[index % detailPalette.length] ?? detailPalette[0];
    context.beginPath();
    context.arc(x, y, 7 + (index % 5), 0, Math.PI * 2);
    context.fill();
  }

  drawMicroPatch(88, 96, 388, 0);
  drawMicroPatch(1420, 132, 430, 1);
  drawMicroPatch(170, 1370, 462, 2);
  drawMicroPatch(1290, 1260, 520, 3);
  drawMicroPatch(770, 720, 360, 4);

  context.fillStyle = 'rgba(255, 235, 166, 0.86)';
  context.font = '700 58px ui-monospace, SFMono-Regular, Consolas, monospace';
  context.textBaseline = 'top';
  context.fillText('HI-0', 650, 118);
  context.fillText('HI-1', 1110, 360);
  context.fillText('HI-2', 580, 1720);
  context.font = '700 22px ui-monospace, SFMono-Regular, Consolas, monospace';
  for (let index = 0; index < 34; index += 1) {
    context.fillText(String(index % 10), 680 + index * 21, 202 + (index % 3) * 18);
  }

  context.fillStyle = 'rgba(161, 224, 227, 0.68)';
  context.font = '700 42px ui-monospace, SFMono-Regular, Consolas, monospace';
  context.fillText('COARSE', 76, 1844);
  context.fillText('MIP', 1660, 1880);

  drawGrid(256, 8, 'rgba(154, 228, 231, 0.58)');
  drawGrid(64, 2, 'rgba(255, 232, 150, 0.38)');
  drawGrid(16, 1, 'rgba(255, 154, 69, 0.16)');

  context.strokeStyle = '#06131d';
  context.lineWidth = 18;
  context.strokeRect(9, 9, size - 18, size - 18);

  return canvas.toDataURL('image/png');
};

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const createSurfaceMaterial = (): UnlitMaterial =>
  unlitMaterial({
    baseColor: textureAsset({
      colorSpace: 'srgb',
      fallback: fallbackTexture,
      id: 'generated-virtual-texturing-surface',
      // TODO(public-vt-descriptor): replace this image asset with a renderer-core
      // virtual texture descriptor when core exposes one.
      revision: 'generated-v2',
      sampler: {
        magFilter: 'linear',
        minFilter: 'linear-mipmap-linear',
        wrapS: 'clamp-to-edge',
        wrapT: 'clamp-to-edge',
      },
      uri: createGeneratedTextureUri(),
    }),
  });

const virtualTexturingScene = (surfaceMaterial: UnlitMaterial, view: SurfaceView): RenderRoot => (
  <scene>
    <pass clearColor={[0.035, 0.045, 0.052, 1]}>
      <perspectiveCamera
        far={100}
        fovY={Math.PI / 5}
        near={0.1}
        position={[view.offset[0], view.offset[1], view.zoom]}
        rotation={[0, 0, 0]}
      />
      <mesh
        geometry={surfaceGeometry}
        material={surfaceMaterial}
        transform={{
          position: [0, 0, 0],
          rotation: [view.rotation[0], view.rotation[1], 0],
        }}
      />
    </pass>
  </scene>
) as RenderRoot;

export const VirtualTexturingPlane = (): ReactNode => {
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<SurfaceView>(defaultView);
  const dragRef = useRef<DragState | undefined>(undefined);
  const surfaceMaterial = useMemo(createSurfaceMaterial, []);
  const resetView = useCallback(() => {
    setView(defaultView);
  }, []);
  const zoomView = useCallback((event: WheelEvent<HTMLCanvasElement>) => {
    const deltaY = event.deltaY;

    event.preventDefault();
    setView((current) => {
      const zoom = clamp(
        current.zoom * Math.exp(deltaY * 0.0011),
        minCameraZ,
        maxCameraZ,
      );

      return {
        offset: clampOffset(current.offset, zoom),
        rotation: current.rotation,
        zoom,
      };
    });
  }, []);
  const startDrag = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const mode: DragMode = event.shiftKey || event.button !== 0 ? 'pan' : 'rotate';
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startOffset: view.offset,
      startRotation: view.rotation,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDragging(true);
  }, [view.offset, view.rotation]);
  const moveDrag = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag === undefined || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    setView((current) => {
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (drag.mode === 'rotate') {
        return {
          offset: current.offset,
          rotation: clampRotation([
            drag.startRotation[0] + deltaY * 0.006,
            drag.startRotation[1] + deltaX * 0.006,
          ]),
          zoom: current.zoom,
        };
      }

      const sensitivity = current.zoom * 0.0016;

      return {
        offset: clampOffset(
          [
            drag.startOffset[0] - deltaX * sensitivity,
            drag.startOffset[1] + deltaY * sensitivity,
          ],
          current.zoom,
        ),
        rotation: current.rotation,
        zoom: current.zoom,
      };
    });
  }, []);
  const endDrag = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = undefined;
    setDragging(false);
  }, []);

  return createElement(Canvas, {
    'aria-label': 'Virtual texturing plane',
    children: virtualTexturingScene(surfaceMaterial, view),
    onContextMenu: (event) => {
      event.preventDefault();
    },
    onDoubleClick: resetView,
    onPointerCancel: endDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onWheel: zoomView,
    rootOptions,
    style: {
      cursor: dragging ? 'grabbing' : 'grab',
      touchAction: 'none',
    },
    onPointerDown: startDrag,
  });
};
