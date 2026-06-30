import { Canvas } from '@royal/react';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { virtualTexturingScene, type SurfaceView } from './VirtualTexturingPlane.scene';
import { createSurfaceMaterial } from './VirtualTexturingPlane.texture';

// Lab probe only. This previews a public VT descriptor with a generated texture while
// renderer lowering is pending; it is intentionally not exported in the product catalog.
type DragMode = 'pan' | 'rotate';

type DragState = {
  readonly mode: DragMode;
  readonly pointerId: number;
  readonly startOffset: readonly [number, number];
  readonly startRotation: readonly [number, number];
  readonly startX: number;
  readonly startY: number;
};

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

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

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

export const VirtualTexturingPlane = (): ReactNode => {
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<SurfaceView>(defaultView);
  const dragRef = useRef<DragState | undefined>(undefined);
  const surfaceMaterial = useMemo(() => createSurfaceMaterial(), []);

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

  return (
    <Canvas
      aria-label="Virtual texturing descriptor lab probe"
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onDoubleClick={resetView}
      onPointerCancel={endDrag}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onWheel={zoomView}
      rootOptions={rootOptions}
      data-example-maturity="lab-probe"
      data-product-demo="false"
      data-virtual-texture-preview="descriptor"
      data-virtual-texture-probe-label="renderer-lowering-pending"
      style={{
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      {virtualTexturingScene(surfaceMaterial, view)}
    </Canvas>
  );
};
