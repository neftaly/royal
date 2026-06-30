export interface CanvasWorldBounds {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export const canvasPointToWorld = (
  canvas: HTMLCanvasElement,
  bounds: CanvasWorldBounds,
  clientX: number,
  clientY: number,
): readonly [x: number, y: number] => {
  const rect = canvas.getBoundingClientRect();
  const xRatio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
  const yRatio = rect.height <= 0 ? 0 : (clientY - rect.top) / rect.height;

  return [
    bounds.left + xRatio * (bounds.right - bounds.left),
    bounds.top - yRatio * (bounds.top - bounds.bottom),
  ];
};

export const worldPointToCanvasClient = (
  canvas: HTMLCanvasElement,
  bounds: CanvasWorldBounds,
  worldX: number,
  worldY: number,
): readonly [clientX: number, clientY: number] => {
  const rect = canvas.getBoundingClientRect();
  return [
    rect.left + ((worldX - bounds.left) / (bounds.right - bounds.left)) * rect.width,
    rect.top + ((bounds.top - worldY) / (bounds.top - bounds.bottom)) * rect.height,
  ];
};
