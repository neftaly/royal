export type FrameViews = {
  capacity: number;
  count: number;
  framebuffer: WebGLFramebuffer | null;
  projections: Float32Array;
  scissor: boolean;
  viewProjections: Float32Array;
  viewports: Int32Array;
  views: Float32Array;
};

const MATRIX_LENGTH = 16;
const VIEWPORT_LENGTH = 4;

const normalizedCapacity = (capacity: number): number => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error("Royal frame-view capacity must be a positive integer");
  }
  return capacity;
};

export const createFrameViews = (initialCapacity = 1): FrameViews => {
  const capacity = normalizedCapacity(initialCapacity);
  return {
    capacity,
    count: 0,
    framebuffer: null,
    projections: new Float32Array(capacity * MATRIX_LENGTH),
    scissor: false,
    viewProjections: new Float32Array(capacity * MATRIX_LENGTH),
    viewports: new Int32Array(capacity * VIEWPORT_LENGTH),
    views: new Float32Array(capacity * MATRIX_LENGTH),
  };
};

const growFrameViews = (frameViews: FrameViews, minimumCapacity: number): void => {
  if (minimumCapacity <= frameViews.capacity) return;
  let capacity = frameViews.capacity;
  while (capacity < minimumCapacity) capacity *= 2;

  const projections = new Float32Array(capacity * MATRIX_LENGTH);
  const views = new Float32Array(capacity * MATRIX_LENGTH);
  const viewProjections = new Float32Array(capacity * MATRIX_LENGTH);
  const viewports = new Int32Array(capacity * VIEWPORT_LENGTH);
  projections.set(frameViews.projections);
  views.set(frameViews.views);
  viewProjections.set(frameViews.viewProjections);
  viewports.set(frameViews.viewports);
  frameViews.capacity = capacity;
  frameViews.projections = projections;
  frameViews.views = views;
  frameViews.viewProjections = viewProjections;
  frameViews.viewports = viewports;
};

export const resetFrameViews = (
  frameViews: FrameViews,
  framebuffer: WebGLFramebuffer | null,
  scissor: boolean,
): void => {
  frameViews.count = 0;
  frameViews.framebuffer = framebuffer;
  frameViews.scissor = scissor;
};

const copyMatrix = (
  target: Float32Array,
  offset: number,
  source: ArrayLike<number>,
): void => {
  if (source.length !== MATRIX_LENGTH) {
    throw new Error("Royal WebGL render views require 4x4 matrices");
  }
  for (let index = 0; index < MATRIX_LENGTH; index += 1) {
    target[offset + index] = source[index]!;
  }
};

const multiplyMatrixRows = (
  target: Float32Array,
  left: Float32Array,
  right: Float32Array,
  offset: number,
): void => {
  for (let column = 0; column < 4; column += 1) {
    const columnOffset = offset + column * 4;
    for (let row = 0; row < 4; row += 1) {
      target[columnOffset + row] =
        left[offset + row]! * right[columnOffset]!
        + left[offset + 4 + row]! * right[columnOffset + 1]!
        + left[offset + 8 + row]! * right[columnOffset + 2]!
        + left[offset + 12 + row]! * right[columnOffset + 3]!;
    }
  }
};

const viewportInteger = (value: number, name: string, minimum: number): number => {
  if (!Number.isInteger(value) || value < minimum || value > 0x7fffffff) {
    throw new Error(`Royal WebGL render-view ${name} must be a signed 32-bit integer at least ${minimum}`);
  }
  return value;
};

export const appendFrameView = (
  frameViews: FrameViews,
  projection: ArrayLike<number>,
  view: ArrayLike<number>,
  x: number,
  y: number,
  width: number,
  height: number,
): void => {
  const index = frameViews.count;
  growFrameViews(frameViews, index + 1);
  const matrixOffset = index * MATRIX_LENGTH;
  copyMatrix(frameViews.projections, matrixOffset, projection);
  copyMatrix(frameViews.views, matrixOffset, view);
  multiplyMatrixRows(
    frameViews.viewProjections,
    frameViews.projections,
    frameViews.views,
    matrixOffset,
  );

  const viewportOffset = index * VIEWPORT_LENGTH;
  frameViews.viewports[viewportOffset] = viewportInteger(x, "x", -0x80000000);
  frameViews.viewports[viewportOffset + 1] = viewportInteger(y, "y", -0x80000000);
  frameViews.viewports[viewportOffset + 2] = viewportInteger(width, "width", 1);
  frameViews.viewports[viewportOffset + 3] = viewportInteger(height, "height", 1);
  frameViews.count = index + 1;
};

export const copyFrameViewMatrixInto = (
  target: { [index: number]: number },
  source: Float32Array,
  viewIndex: number,
): void => {
  const offset = viewIndex * MATRIX_LENGTH;
  for (let index = 0; index < MATRIX_LENGTH; index += 1) {
    target[index] = source[offset + index]!;
  }
};
