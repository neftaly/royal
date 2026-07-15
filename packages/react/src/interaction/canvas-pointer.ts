export const captureCanvasPointer = (
  canvas: HTMLCanvasElement,
  pointerId: number,
): void => {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // Synthetic pointer events can lack an active pointer in tests and browser probes.
  }
};

export const releaseCanvasPointer = (
  canvas: HTMLCanvasElement,
  pointerId: number,
): void => {
  try {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {
    // See captureCanvasPointer().
  }
};
