import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  createOrbitControls,
  type OrbitCameraView,
  type OrbitControlsHandle,
} from '@royal/react';

const ghostscriptTigerSvgUrl =
  'https://upload.wikimedia.org/wikipedia/commons/f/fd/Ghostscript_Tiger.svg';

type TigerGl = WebGLRenderingContext | WebGL2RenderingContext;

type FailureState = {
  readonly detail: string;
  readonly title: string;
};

type RenderState = 'failed' | 'loading' | 'ready';

type PixelPoint = {
  readonly x: number;
  readonly y: number;
};

type TigerMesh = {
  readonly fillIndices: Uint16Array;
  readonly positions: Float32Array;
  readonly texCoords: Float32Array;
  readonly wireLods: readonly TigerWireLod[];
};

type TigerAlphaMask = {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
};

type TigerWireLod = {
  readonly contourCount: number;
  readonly label: string;
  readonly maxPointsPerContour: number;
  readonly positions: Float32Array;
  readonly tolerancePixels: number;
  readonly vertexCount: number;
};

type TigerRenderer = {
  dispose(): void;
  draw(): void;
  drawFailureSquare(): void;
  setCameraView(view: OrbitCameraView): void;
  uploadTexture(textureSource: TigerTextureSource): void;
};

type TigerTextureSource = {
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly width: number;
};

const tigerTextureSize = 512;
const tigerTexturePadding = 40;
const tigerAlphaThreshold = 24;
const tigerWireMaskCloseRadius = 4;
const tigerWireMaskDilateRadius = 8;
const tigerWireContourMinArea = 144;
const tigerWireframeColor = [0.38, 0.85, 0.95, 1] as const;
const tigerWireframeWidth = 1.25;
const targetWireErrorPx = 10;
const tigerWireLodSpecs = [
  { label: 'fine', maxPointsPerContour: 256, tolerancePixels: 2 },
  { label: 'medium', maxPointsPerContour: 128, tolerancePixels: 8 },
  { label: 'small', maxPointsPerContour: 96, tolerancePixels: 12 },
] as const;
const tigerProjectionScale = 2.35;

const containerStyle = {
  blockSize: '100%',
  inlineSize: '100%',
  overflow: 'hidden',
  position: 'relative',
} satisfies CSSProperties;

const failureStyle = {
  background: 'rgb(120 0 18 / 0.86)',
  border: '1px solid rgb(255 117 117 / 0.75)',
  borderRadius: '6px',
  color: '#fff4f4',
  fontSize: '0.82rem',
  insetBlockEnd: '0.85rem',
  insetInlineStart: '0.85rem',
  lineHeight: 1.35,
  maxInlineSize: 'min(30rem, calc(100% - 1.7rem))',
  padding: '0.65rem 0.75rem',
  position: 'absolute',
} satisfies CSSProperties;

const failureTitleStyle = {
  display: 'block',
  fontWeight: 750,
  marginBlockEnd: '0.15rem',
} satisfies CSSProperties;

const canvasStyle = {
  blockSize: '100%',
  cursor: 'grab',
  inlineSize: '100%',
  touchAction: 'none',
} satisfies CSSProperties;

const fallbackSquareStyle = {
  background: '#ff0000',
  blockSize: '3.5rem',
  border: '2px solid #fff4f4',
  borderRadius: '3px',
  boxShadow: '0 0 0 1px rgb(70 0 0 / 0.8)',
  inlineSize: '3.5rem',
  insetBlockStart: '0.85rem',
  insetInlineStart: '0.85rem',
  pointerEvents: 'none',
  position: 'absolute',
} satisfies CSSProperties;

const tigerProjectionShaderSource = `
vec4 projectTigerPosition(
  vec2 position,
  float aspect,
  vec3 cameraTarget,
  float cameraDistance,
  float cameraPitch,
  float cameraYaw
) {
  vec3 p = vec3(position, 0.0) - cameraTarget;

  float cy = cos(cameraYaw);
  float sy = sin(cameraYaw);
  float cx = cos(cameraPitch);
  float sx = sin(cameraPitch);

  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p.z -= max(cameraDistance, 0.0001);

  float clipW = max(-p.z, 0.0001);
  return vec4((p.x * ${tigerProjectionScale}) / max(aspect, 0.0001), p.y * ${tigerProjectionScale}, 0.0, clipW);
}
`;

const textureVertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;

uniform float u_aspect;
uniform float u_cameraDistance;
uniform float u_cameraPitch;
uniform vec3 u_cameraTarget;
uniform float u_cameraYaw;

varying vec2 v_texCoord;

${tigerProjectionShaderSource}

void main() {
  v_texCoord = a_texCoord;
  gl_Position = projectTigerPosition(
    a_position,
    u_aspect,
    u_cameraTarget,
    u_cameraDistance,
    u_cameraPitch,
    u_cameraYaw
  );
}
`;

const textureFragmentShaderSource = `
precision mediump float;

uniform sampler2D u_tigerTexture;

varying vec2 v_texCoord;

void main() {
  vec4 color = texture2D(u_tigerTexture, v_texCoord);
  if (color.a <= 0.001) discard;
  gl_FragColor = color;
}
`;

const wireVertexShaderSource = `
attribute vec2 a_position;

uniform float u_aspect;
uniform float u_cameraDistance;
uniform float u_cameraPitch;
uniform vec3 u_cameraTarget;
uniform float u_cameraYaw;

${tigerProjectionShaderSource}

void main() {
  gl_Position = projectTigerPosition(
    a_position,
    u_aspect,
    u_cameraTarget,
    u_cameraDistance,
    u_cameraPitch,
    u_cameraYaw
  );
}
`;

const wireFragmentShaderSource = `
precision mediump float;

uniform vec4 u_wireColor;

void main() {
  gl_FragColor = u_wireColor;
}
`;

const tigerWorldHeight = 2.72;
const defaultTigerCameraView = {
  distance: 3.75,
  pitch: 0.18,
  target: [0, 0, 0],
  yaw: -0.28,
} satisfies OrbitCameraView;
const tigerOrbitOptions = {
  panSpeed: 0.0018,
  rotateSpeed: 0.006,
  zoomSpeed: 0.002,
} as const;

const pixelRatio = (): number => Math.min(globalThis.devicePixelRatio || 1, 1);

const resizeCanvas = (canvas: HTMLCanvasElement, gl: TigerGl): void => {
  const ratio = pixelRatio();
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round((rect.width || canvas.clientWidth || 1) * ratio));
  const height = Math.max(1, Math.round((rect.height || canvas.clientHeight || 1) * ratio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, width, height);
};

const canvasAspect = (canvas: HTMLCanvasElement): number =>
  canvas.height === 0 ? 1 : canvas.width / canvas.height;

const projectedTigerHeightPixels = (canvasHeight: number, cameraDistance: number): number =>
  (canvasHeight * tigerProjectionScale * tigerWorldHeight) / (2 * Math.max(cameraDistance, 0.0001));

const alphaAt = (textureSource: TigerTextureSource, x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= textureSource.width || y >= textureSource.height) return 0;
  return textureSource.pixels[(y * textureSource.width + x) * 4 + 3] ?? 0;
};

const isTigerAlphaSolid = (textureSource: TigerTextureSource, x: number, y: number): boolean =>
  alphaAt(textureSource, x, y) > tigerAlphaThreshold;

const maskAt = (mask: TigerAlphaMask, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.data[y * mask.width + x] === 1;

const pointKey = ({ x, y }: PixelPoint): string => `${x},${y}`;

const createTigerBaseAlphaMask = (textureSource: TigerTextureSource): TigerAlphaMask => {
  const data = new Uint8Array(textureSource.width * textureSource.height);

  for (let y = 0; y < textureSource.height; y += 1) {
    for (let x = 0; x < textureSource.width; x += 1) {
      if (isTigerAlphaSolid(textureSource, x, y)) data[y * textureSource.width + x] = 1;
    }
  }

  return {
    data,
    height: textureSource.height,
    width: textureSource.width,
  };
};

const dilateAlphaMask = (mask: TigerAlphaMask, radius: number): TigerAlphaMask => {
  if (radius <= 0) return mask;

  const { height, width } = mask;
  const horizontal = new Uint8Array(mask.data.length);
  const output = new Uint8Array(mask.data.length);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) {
      count += mask.data[rowOffset + x] ?? 0;
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[rowOffset + x] = count > 0 ? 1 : 0;

      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) count -= mask.data[rowOffset + removeX] ?? 0;
      if (addX < width) count += mask.data[rowOffset + addX] ?? 0;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) {
      count += horizontal[y * width + x] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = count > 0 ? 1 : 0;

      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) count -= horizontal[removeY * width + x] ?? 0;
      if (addY < height) count += horizontal[addY * width + x] ?? 0;
    }
  }

  return {
    data: output,
    height,
    width,
  };
};

const erodeAlphaMask = (mask: TigerAlphaMask, radius: number): TigerAlphaMask => {
  if (radius <= 0) return mask;

  const { height, width } = mask;
  const horizontal = new Uint8Array(mask.data.length);
  const output = new Uint8Array(mask.data.length);
  const required = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) {
      count += mask.data[rowOffset + x] ?? 0;
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[rowOffset + x] = count === required ? 1 : 0;

      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) count -= mask.data[rowOffset + removeX] ?? 0;
      if (addX < width) count += mask.data[rowOffset + addX] ?? 0;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) {
      count += horizontal[y * width + x] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = count === required ? 1 : 0;

      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) count -= horizontal[removeY * width + x] ?? 0;
      if (addY < height) count += horizontal[addY * width + x] ?? 0;
    }
  }

  return {
    data: output,
    height,
    width,
  };
};

const createTigerWireAlphaMask = (textureSource: TigerTextureSource): TigerAlphaMask => {
  // This coarsens only the wire mesh; the tiger texture still renders on the full padded quad.
  const baseMask = createTigerBaseAlphaMask(textureSource);
  const closedMask = erodeAlphaMask(
    dilateAlphaMask(baseMask, tigerWireMaskCloseRadius),
    tigerWireMaskCloseRadius,
  );

  return dilateAlphaMask(closedMask, tigerWireMaskDilateRadius);
};

const pointDistanceToSegment = (point: PixelPoint, start: PixelPoint, end: PixelPoint): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
};

const simplifyOpenPoints = (points: readonly PixelPoint[], tolerance: number): readonly PixelPoint[] => {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;

  let maxDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    const distance = pointDistanceToSegment(point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }

  if (maxDistance <= tolerance) return [first, last];

  const left = simplifyOpenPoints(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyOpenPoints(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
};

const simplifyClosedPoints = (points: readonly PixelPoint[], tolerance: number): readonly PixelPoint[] => {
  if (points.length <= 3 || tolerance <= 0) return points;

  const first = points[0];
  if (first === undefined) return points;
  const simplified = simplifyOpenPoints([...points, first], tolerance).slice(0, -1);
  return simplified.length >= 3 ? simplified : points;
};

const maxDistanceToClosedPoints = (
  sourcePoints: readonly PixelPoint[],
  contourPoints: readonly PixelPoint[],
): number => {
  let maxDistance = 0;

  for (const point of sourcePoints) {
    let minDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < contourPoints.length; index += 1) {
      const start = contourPoints[index];
      const end = contourPoints[(index + 1) % contourPoints.length];
      if (start === undefined || end === undefined) continue;
      minDistance = Math.min(minDistance, pointDistanceToSegment(point, start, end));
    }

    if (Number.isFinite(minDistance)) maxDistance = Math.max(maxDistance, minDistance);
  }

  return maxDistance;
};

const limitClosedPoints = (
  points: readonly PixelPoint[],
  maxPoints: number,
  sourcePoints: readonly PixelPoint[],
  tolerance: number,
): readonly PixelPoint[] => {
  if (points.length <= maxPoints || maxPoints < 3) return points;

  const step = points.length / maxPoints;
  const limited: PixelPoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const point = points[Math.floor(index * step)];
    if (point !== undefined) limited.push(point);
  }

  if (limited.length < 3) return points;
  return maxDistanceToClosedPoints(sourcePoints, limited) <= tolerance ? limited : points;
};

const traceTigerAlphaContours = (mask: TigerAlphaMask): readonly (readonly PixelPoint[])[] => {
  const edges: { readonly end: PixelPoint; readonly start: PixelPoint }[] = [];
  const starts = new Map<string, number[]>();

  const addEdge = (start: PixelPoint, end: PixelPoint): void => {
    const index = edges.length;
    edges.push({ end, start });
    const key = pointKey(start);
    const bucket = starts.get(key);
    if (bucket === undefined) {
      starts.set(key, [index]);
    } else {
      bucket.push(index);
    }
  };

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!maskAt(mask, x, y)) continue;

      if (!maskAt(mask, x, y - 1)) addEdge({ x, y }, { x: x + 1, y });
      if (!maskAt(mask, x + 1, y)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 });
      if (!maskAt(mask, x, y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
      if (!maskAt(mask, x - 1, y)) addEdge({ x, y: y + 1 }, { x, y });
    }
  }

  const contours: PixelPoint[][] = [];
  const visited = new Uint8Array(edges.length);

  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    if (visited[edgeIndex] === 1) continue;

    const firstEdge = edges[edgeIndex];
    if (firstEdge === undefined) continue;
    const contour: PixelPoint[] = [];
    let currentIndex = edgeIndex;

    while (visited[currentIndex] !== 1) {
      const edge = edges[currentIndex];
      if (edge === undefined) break;
      visited[currentIndex] = 1;
      contour.push(edge.start);

      const nextCandidates = starts.get(pointKey(edge.end)) ?? [];
      const nextIndex = nextCandidates.find((candidate) => visited[candidate] !== 1);
      if (nextIndex === undefined) break;
      currentIndex = nextIndex;
    }

    if (contour.length >= 3) contours.push(contour);
  }

  return contours;
};

const contourArea = (points: readonly PixelPoint[]): number => {
  let doubleArea = 0;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    if (point === undefined || next === undefined) continue;
    doubleArea += point.x * next.y - next.x * point.y;
  }

  return Math.abs(doubleArea) / 2;
};

const createTigerWireLods = (
  textureSource: TigerTextureSource,
  halfWidth: number,
  halfHeight: number,
): readonly TigerWireLod[] => {
  const wireMask = createTigerWireAlphaMask(textureSource);
  const contours = traceTigerAlphaContours(wireMask)
    .filter((contour) => contourArea(contour) >= tigerWireContourMinArea);
  const pixelToWorld = ({ x, y }: PixelPoint): readonly [x: number, y: number] => [
    -halfWidth + (x / textureSource.width) * halfWidth * 2,
    -halfHeight + (y / textureSource.height) * halfHeight * 2,
  ];

  return tigerWireLodSpecs.map((spec) => {
    const positions: number[] = [];
    let contourCount = 0;

    for (const contour of contours) {
      const simplified = limitClosedPoints(
        simplifyClosedPoints(contour, spec.tolerancePixels),
        spec.maxPointsPerContour,
        contour,
        spec.tolerancePixels,
      );
      if (simplified.length < 2) continue;
      contourCount += 1;

      for (let index = 0; index < simplified.length; index += 1) {
        const start = simplified[index];
        const end = simplified[(index + 1) % simplified.length];
        if (start === undefined || end === undefined) continue;
        positions.push(...pixelToWorld(start), ...pixelToWorld(end));
      }
    }

    return {
      contourCount,
      label: spec.label,
      maxPointsPerContour: spec.maxPointsPerContour,
      positions: new Float32Array(positions),
      tolerancePixels: spec.tolerancePixels,
      vertexCount: positions.length / 2,
    };
  });
};

const createTigerMesh = (textureSource: TigerTextureSource): TigerMesh => {
  const textureAspect = textureSource.width / Math.max(1, textureSource.height);
  const halfHeight = tigerWorldHeight / 2;
  const halfWidth = (tigerWorldHeight * textureAspect) / 2;
  const wireLods = createTigerWireLods(textureSource, halfWidth, halfHeight);

  return {
    fillIndices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    positions: new Float32Array([
      -halfWidth, halfHeight,
      halfWidth, halfHeight,
      halfWidth, -halfHeight,
      -halfWidth, -halfHeight,
    ]),
    texCoords: new Float32Array([
      0, 1,
      1, 1,
      1, 0,
      0, 0,
    ]),
    wireLods,
  };
};

const shaderInfoLog = (gl: TigerGl, shader: WebGLShader): string =>
  gl.getShaderInfoLog(shader)?.trim() ?? '';

const compileShader = (gl: TigerGl, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('Failed to create WebGL shader.');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = shaderInfoLog(gl, shader);
    gl.deleteShader(shader);
    throw new Error(log === '' ? 'Failed to compile WebGL shader.' : log);
  }

  return shader;
};

const createProgram = (
  gl: TigerGl,
  vertexShaderSource: string,
  fragmentShaderSource: string,
): WebGLProgram => {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (program === null) throw new Error('Failed to create WebGL program.');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)?.trim() ?? '';
    gl.deleteProgram(program);
    throw new Error(log === '' ? 'Failed to link WebGL program.' : log);
  }

  return program;
};

const requiredAttribute = (gl: TigerGl, program: WebGLProgram, name: string): number => {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Missing WebGL attribute ${name}.`);
  return location;
};

const requiredUniform = (gl: TigerGl, program: WebGLProgram, name: string): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new Error(`Missing WebGL uniform ${name}.`);
  return location;
};

type TigerCameraUniforms = {
  readonly aspect: WebGLUniformLocation;
  readonly distance: WebGLUniformLocation;
  readonly pitch: WebGLUniformLocation;
  readonly target: WebGLUniformLocation;
  readonly yaw: WebGLUniformLocation;
};

const tigerCameraUniforms = (gl: TigerGl, program: WebGLProgram): TigerCameraUniforms => ({
  aspect: requiredUniform(gl, program, 'u_aspect'),
  distance: requiredUniform(gl, program, 'u_cameraDistance'),
  pitch: requiredUniform(gl, program, 'u_cameraPitch'),
  target: requiredUniform(gl, program, 'u_cameraTarget'),
  yaw: requiredUniform(gl, program, 'u_cameraYaw'),
});

const setTigerCameraUniforms = (
  gl: TigerGl,
  uniforms: TigerCameraUniforms,
  aspect: number,
  view: OrbitCameraView,
): void => {
  gl.uniform1f(uniforms.aspect, aspect);
  gl.uniform1f(uniforms.distance, view.distance);
  gl.uniform1f(uniforms.pitch, view.pitch);
  gl.uniform3f(uniforms.target, view.target[0], view.target[1], view.target[2]);
  gl.uniform1f(uniforms.yaw, view.yaw);
};

const createBuffer = (gl: TigerGl): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error('Failed to create WebGL buffer.');
  return buffer;
};

const createTexture = (gl: TigerGl): WebGLTexture => {
  const texture = gl.createTexture();
  if (texture === null) throw new Error('Failed to create WebGL texture.');
  return texture;
};

const clearCanvas = (gl: TigerGl): void => {
  gl.clearColor(0.032, 0.038, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
};

const failureSquareSize = (canvas: HTMLCanvasElement): number =>
  Math.max(24, Math.min(96, Math.floor(Math.min(canvas.width, canvas.height) * 0.18)));

const drawWebGlFailureSquare = (canvas: HTMLCanvasElement, gl: TigerGl): void => {
  if (gl.isContextLost()) return;

  resizeCanvas(canvas, gl);
  clearCanvas(gl);
  const size = failureSquareSize(canvas);
  const margin = Math.max(8, Math.floor(size * 0.2));
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(margin, Math.max(0, canvas.height - margin - size), size, size);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
};

const drawCanvasFailureSquare = (canvas: HTMLCanvasElement): void => {
  const ratio = pixelRatio();
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round((rect.width || canvas.clientWidth || 1) * ratio));
  canvas.height = Math.max(1, Math.round((rect.height || canvas.clientHeight || 1) * ratio));

  const context = canvas.getContext('2d');
  if (context === null) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const size = failureSquareSize(canvas);
  const margin = Math.max(8, Math.floor(size * 0.2));
  context.fillStyle = '#ff0000';
  context.fillRect(margin, margin, size, size);
};

const createWebGlContext = (canvas: HTMLCanvasElement): TigerGl | null => {
  const attributes = {
    alpha: false,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
    stencil: false,
  } satisfies WebGLContextAttributes;

  const webgl = canvas.getContext('webgl', attributes) as WebGLRenderingContext | null;
  if (webgl !== null) return webgl.isContextLost() ? null : webgl;

  const webgl2 = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null;
  if (webgl2 !== null) return webgl2.isContextLost() ? null : webgl2;

  const experimental = canvas.getContext('experimental-webgl', attributes) as WebGLRenderingContext | null;
  if (experimental !== null) return experimental.isContextLost() ? null : experimental;

  return null;
};

const createTigerRenderer = (
  canvas: HTMLCanvasElement,
  gl: TigerGl,
  initialCameraView: OrbitCameraView,
  textureSource: TigerTextureSource,
): TigerRenderer => {
  const mesh = createTigerMesh(textureSource);
  const textureProgram = createProgram(gl, textureVertexShaderSource, textureFragmentShaderSource);
  const texturePositionLocation = requiredAttribute(gl, textureProgram, 'a_position');
  const textureTexCoordLocation = requiredAttribute(gl, textureProgram, 'a_texCoord');
  const textureCameraUniforms = tigerCameraUniforms(gl, textureProgram);
  const textureLocation = requiredUniform(gl, textureProgram, 'u_tigerTexture');
  const wireProgram = createProgram(gl, wireVertexShaderSource, wireFragmentShaderSource);
  const wirePositionLocation = requiredAttribute(gl, wireProgram, 'a_position');
  const wireCameraUniforms = tigerCameraUniforms(gl, wireProgram);
  const wireColorLocation = requiredUniform(gl, wireProgram, 'u_wireColor');
  const fillIndexBuffer = createBuffer(gl);
  const positionBuffer = createBuffer(gl);
  const texCoordBuffer = createBuffer(gl);
  const wirePositionBuffers = mesh.wireLods.map((lod) => {
    const buffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, lod.positions, gl.STATIC_DRAW);
    return buffer;
  });
  const texture = createTexture(gl);
  let cameraView = initialCameraView;
  let textureReady = false;

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.texCoords, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.fillIndices, gl.STATIC_DRAW);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);

  const bindMeshAttributes = (
    positionLocation: number,
    texCoordLocation: number,
  ): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndexBuffer);
  };

  const bindWireAttributes = (wirePositionBuffer: WebGLBuffer): void => {
    gl.bindBuffer(gl.ARRAY_BUFFER, wirePositionBuffer);
    gl.enableVertexAttribArray(wirePositionLocation);
    gl.vertexAttribPointer(wirePositionLocation, 2, gl.FLOAT, false, 0, 0);
  };

  const currentWireLodIndex = (): number => {
    const projectedHeight = projectedTigerHeightPixels(canvas.height, cameraView.distance);
    const projectedPxPerTexturePx = projectedHeight / tigerTextureSize;

    for (let index = mesh.wireLods.length - 1; index >= 0; index -= 1) {
      const lod = mesh.wireLods[index];
      if (lod !== undefined && lod.tolerancePixels * projectedPxPerTexturePx <= targetWireErrorPx) {
        return index;
      }
    }

    return 0;
  };

  const draw = (): void => {
    if (gl.isContextLost()) return;

    resizeCanvas(canvas, gl);
    clearCanvas(gl);
    if (!textureReady) return;

    const aspect = canvasAspect(canvas);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.useProgram(textureProgram);
    setTigerCameraUniforms(gl, textureCameraUniforms, aspect, cameraView);
    gl.uniform1i(textureLocation, 0);
    bindMeshAttributes(texturePositionLocation, textureTexCoordLocation);
    gl.drawElements(gl.TRIANGLES, mesh.fillIndices.length, gl.UNSIGNED_SHORT, 0);

    const wireLodIndex = currentWireLodIndex();
    const wireLod = mesh.wireLods[wireLodIndex];
    const wirePositionBuffer = wirePositionBuffers[wireLodIndex];
    if (wireLod !== undefined && wirePositionBuffer !== undefined && wireLod.vertexCount > 0) {
      gl.useProgram(wireProgram);
      setTigerCameraUniforms(gl, wireCameraUniforms, aspect, cameraView);
      gl.uniform4f(
        wireColorLocation,
        tigerWireframeColor[0],
        tigerWireframeColor[1],
        tigerWireframeColor[2],
        tigerWireframeColor[3],
      );
      gl.lineWidth(tigerWireframeWidth);
      bindWireAttributes(wirePositionBuffer);
      gl.drawArrays(gl.LINES, 0, wireLod.vertexCount);
    }
  };

  return {
    dispose: () => {
      gl.deleteBuffer(fillIndexBuffer);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(texCoordBuffer);
      for (const buffer of wirePositionBuffers) gl.deleteBuffer(buffer);
      gl.deleteTexture(texture);
      gl.deleteProgram(textureProgram);
      gl.deleteProgram(wireProgram);
    },
    draw,
    drawFailureSquare: () => drawWebGlFailureSquare(canvas, gl),
    setCameraView: (view) => {
      cameraView = view;
      draw();
    },
    uploadTexture: (textureSource) => {
      if (gl.isContextLost()) {
        throw new Error('WebGL context was lost before the SVG texture upload.');
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        textureSource.width,
        textureSource.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        textureSource.pixels,
      );
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        throw new Error(`WebGL texture upload failed with error 0x${error.toString(16)}.`);
      }
      textureReady = true;
      draw();
    },
  };
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to decode ${ghostscriptTigerSvgUrl}`));
    image.src = src;
  });

const createTexturePixels = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): Uint8Array => {
  const source = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(source.length);
  const stride = width * 4;

  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * stride;
    const targetStart = (height - y - 1) * stride;
    pixels.set(source.subarray(sourceStart, sourceStart + stride), targetStart);
  }

  return pixels;
};

const loadTigerTextureSource = async (): Promise<TigerTextureSource> => {
  const response = await fetch(ghostscriptTigerSvgUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${ghostscriptTigerSvgUrl}: ${response.status}`);
  }

  const svg = await response.text();
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = tigerTextureSize;
  canvas.height = tigerTextureSize;
  const context = canvas.getContext('2d', { alpha: true });
  if (context === null) throw new Error('Failed to create SVG rasterization canvas.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const drawLimit = tigerTextureSize - tigerTexturePadding * 2;
  const imageWidth = Math.max(1, image.naturalWidth || image.width || drawLimit);
  const imageHeight = Math.max(1, image.naturalHeight || image.height || drawLimit);
  const imageAspect = imageWidth / imageHeight;
  const drawWidth = imageAspect >= 1 ? drawLimit : drawLimit * imageAspect;
  const drawHeight = imageAspect >= 1 ? drawLimit / imageAspect : drawLimit;
  context.drawImage(
    image,
    (tigerTextureSize - drawWidth) / 2,
    (tigerTextureSize - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return {
    height: canvas.height,
    pixels: createTexturePixels(context, canvas.width, canvas.height),
    width: canvas.width,
  };
};

const formatFailureDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const SvgGateway = (): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [renderState, setRenderState] = useState<RenderState>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    let disposed = false;
    let controls: OrbitControlsHandle | undefined;
    let renderer: TigerRenderer | undefined;
    let gl: TigerGl | null = null;

    const fail = (title: string, error: unknown): void => {
      if (disposed) return;
      if (renderer !== undefined) {
        renderer.drawFailureSquare();
      } else if (gl !== null && !(typeof gl.isContextLost === 'function' && gl.isContextLost())) {
        drawWebGlFailureSquare(canvas, gl);
      } else {
        drawCanvasFailureSquare(canvas);
      }
      setRenderState('failed');
      setFailure({ detail: formatFailureDetail(error), title });
    };

    const onContextLost = (event: Event): void => {
      event.preventDefault();
      fail('WebGL context lost', new Error('The browser reported a lost WebGL context.'));
    };

    canvas.addEventListener('webglcontextlost', onContextLost);
    setRenderState('loading');
    setFailure(null);

    const onResize = (): void => renderer?.draw();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(onResize);
    resizeObserver?.observe(canvas);

    void loadTigerTextureSource().then(
      (textureSource) => {
        if (disposed) return;
        try {
          gl = createWebGlContext(canvas);
          if (gl === null) {
            fail('WebGL unavailable', new Error('This browser did not provide a WebGL or WebGL2 context.'));
            return;
          }

          renderer = createTigerRenderer(canvas, gl, defaultTigerCameraView, textureSource);
          controls = createOrbitControls(canvas, {
            ...tigerOrbitOptions,
            defaultView: defaultTigerCameraView,
            onChange: (view) => renderer?.setCameraView(view),
          });
          renderer.uploadTexture(textureSource);
          setRenderState('ready');
        } catch (error) {
          fail('SVG texture upload failed', error);
        }
      },
      (error: unknown) => fail('SVG texture load failed', error),
    );

    return () => {
      disposed = true;
      controls?.dispose();
      resizeObserver?.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      renderer?.dispose();
      if (gl !== null) gl.bindTexture(gl.TEXTURE_2D, null);
    };
  }, []);

  return (
    <div
      data-svg-gateway-error={failure === null ? undefined : `${failure.title}: ${failure.detail}`}
      data-svg-gateway-failed={renderState === 'failed' ? 'true' : 'false'}
      data-svg-gateway-readiness={renderState}
      data-svg-gateway-ready={renderState === 'ready' ? 'true' : 'false'}
      data-svg-gateway-source={ghostscriptTigerSvgUrl}
      data-svg-gateway-state={renderState}
      aria-busy={renderState === 'loading' ? true : undefined}
      style={containerStyle}
    >
      <canvas
        aria-label="Ghostscript Tiger SVG rendered with a cyan WebGL wireframe mesh"
        data-svg-gateway-canvas=""
        ref={canvasRef}
        style={canvasStyle}
      />
      {failure === null
        ? null
        : (
          <span
            aria-hidden
            data-svg-gateway-fallback-square=""
            style={fallbackSquareStyle}
          />
        )}
      {failure === null
        ? null
        : (
          <div role="status" style={failureStyle}>
            <strong style={failureTitleStyle}>{`${failure.title}: `}</strong>
            {failure.detail}
          </div>
        )}
    </div>
  );
};
