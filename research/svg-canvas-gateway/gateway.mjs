const DEFAULT_TEXTURE_SIZE = 256;

const ensureCanvas2d = (canvas) => {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Expected a 2D canvas context.');
  }

  return context;
};

const makeCanvas = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const loadImageFromUrl = async (url) => {
  if (typeof createImageBitmap === 'function') {
    const response = await fetch(url);
    const blob = await response.blob();
    return createImageBitmap(blob);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image URL: ${url}`));
    image.src = url;
  });
};

const serializeSvgSource = (svgSource) => {
  if (svgSource instanceof Blob) {
    return {
      blob: svgSource,
      revoke: undefined,
    };
  }

  const svgText =
    typeof svgSource === 'string'
      ? svgSource
      : new XMLSerializer().serializeToString(svgSource);

  return {
    blob: new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }),
    revoke: undefined,
  };
};

const imageDataFromCanvas = (canvas, width, height) => {
  const context = ensureCanvas2d(canvas);
  return context.getImageData(0, 0, width, height);
};

const createCanvasTextureSource = ({
  id,
  kind,
  width = DEFAULT_TEXTURE_SIZE,
  height = DEFAULT_TEXTURE_SIZE,
  draw,
  metadata = {},
}) => {
  const cacheKey = `${kind}:${id}:${width}x${height}:${metadata.cacheVersion ?? 'v1'}`;

  const renderToCanvas = async () => {
    const canvas = makeCanvas(width, height);
    const context = ensureCanvas2d(canvas);
    context.clearRect(0, 0, width, height);
    await draw(context, { canvas, width, height });
    return { canvas, width, height };
  };

  const toImageData = async () => {
    const rendered = await renderToCanvas();
    return {
      ...rendered,
      imageData: imageDataFromCanvas(rendered.canvas, width, height),
    };
  };

  return {
    id,
    kind,
    width,
    height,
    cacheKey,
    metadata,
    renderToCanvas,
    toImageData,
  };
};

const createSvgTextureSource = ({
  id = 'svg-texture',
  svg,
  width = DEFAULT_TEXTURE_SIZE,
  height = DEFAULT_TEXTURE_SIZE,
  imageSmoothingEnabled = true,
  metadata = {},
}) =>
  createCanvasTextureSource({
    id,
    kind: 'svg-raster-texture',
    width,
    height,
    metadata,
    draw: async (context) => {
      const { blob } = serializeSvgSource(svg);
      const url = URL.createObjectURL(blob);

      try {
        const image = await loadImageFromUrl(url);
        context.imageSmoothingEnabled = imageSmoothingEnabled;
        context.drawImage(image, 0, 0, width, height);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  });

const createRasterTextTextureSource = ({
  id = 'canvas-texture-text',
  text,
  width = 512,
  height = 128,
  font = '700 72px system-ui, sans-serif',
  fillStyle = '#f8f3df',
  strokeStyle,
  lineWidth = 0,
  textAlign = 'center',
  textBaseline = 'middle',
  metadata = {},
}) =>
  createCanvasTextureSource({
    id,
    kind: 'canvas-raster-texture',
    width,
    height,
    metadata,
    draw: (context) => {
      context.font = font;
      context.textAlign = textAlign;
      context.textBaseline = textBaseline;

      if (strokeStyle !== undefined && lineWidth > 0) {
        context.strokeStyle = strokeStyle;
        context.lineWidth = lineWidth;
        context.strokeText(text, width / 2, height / 2);
      }

      context.fillStyle = fillStyle;
      context.fillText(text, width / 2, height / 2);
    },
  });

const sprite = ({ texture, geometry, hitRegion, transform = { x: 0, y: 0 } }) => ({
  kind: 'sprite',
  texture,
  geometry,
  hitRegion,
  transform,
});

export {
  createCanvasTextureSource,
  createRasterTextTextureSource,
  createSvgTextureSource,
  sprite,
};
