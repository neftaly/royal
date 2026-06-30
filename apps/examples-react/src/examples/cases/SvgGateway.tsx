import { Canvas, canvasPointToWorld } from '@royal/react';
import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  svgGatewayCameraBounds,
  svgGatewayHitTargetAt,
  svgGatewayScene,
  type SvgGatewayExampleId,
} from './SvgGateway.scene';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const SvgGateway = (): ReactNode => {
  const [activeId, setActiveId] = useState<SvgGatewayExampleId | undefined>();

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    setActiveId(
      svgGatewayHitTargetAt(
        canvasPointToWorld(
          event.currentTarget,
          svgGatewayCameraBounds,
          event.clientX,
          event.clientY,
        ),
      ),
    );
  };

  return (
    <Canvas
      aria-label="SVG gateway"
      data-svg-gateway-active-id={activeId ?? 'none'}
      onPointerLeave={() => setActiveId(undefined)}
      onPointerMove={handlePointerMove}
      rootOptions={rootOptions}
    >
      {svgGatewayScene(activeId)}
    </Canvas>
  );
};
