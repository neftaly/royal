import {
  linearRgbaFromSrgb,
  type LinearRgba,
  type SrgbRgba,
} from '@royal/react/scene';

let colorContext: CanvasRenderingContext2D | undefined;

const getColorContext = (): CanvasRenderingContext2D => {
  if (colorContext !== undefined) return colorContext;
  if (typeof document === 'undefined') {
    throw new Error('htmlColor requires a browser document');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    throw new Error('htmlColor could not create a 2D canvas context');
  }

  colorContext = context;
  return context;
};

export const htmlColor = (value: string): LinearRgba => {
  const context = getColorContext();
  const sentinel = '#010203';

  context.fillStyle = sentinel;
  context.fillStyle = value;
  if (
    context.fillStyle === sentinel &&
    value.trim().toLowerCase() !== sentinel &&
    globalThis.CSS?.supports?.('color', value) !== true
  ) {
    throw new Error(`Invalid HTML color: ${value}`);
  }

  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
  return linearRgbaFromSrgb([red / 255, green / 255, blue / 255, alpha / 255] satisfies SrgbRgba);
};
