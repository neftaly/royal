export const IBL_BRDF_LUT_SIZE = 64;
export const IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT = 15;

const radicalInverseVdc = (bits: number): number => {
  bits = (bits << 16) | (bits >>> 16);
  bits = ((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1);
  bits = ((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2);
  bits = ((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4);
  bits = ((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8);
  return (bits >>> 0) * 2.3283064365386963e-10;
};

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

const geometrySchlickGgx = (ndot: number, roughness: number): number => {
  const a = roughness;
  const k = (a * a) / 2;
  return ndot / (ndot * (1 - k) + k);
};

const integrateBrdf = (roughness: number, ndotv: number): readonly [number, number] => {
  const sampleCount = 128;
  const vx = Math.sqrt(Math.max(1 - ndotv * ndotv, 0));
  const vz = ndotv;
  const a = roughness * roughness;
  let scale = 0;
  let bias = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const xi0 = index / sampleCount;
    const xi1 = radicalInverseVdc(index);
    const phi = 2 * Math.PI * xi0;
    const cosTheta = Math.sqrt((1 - xi1) / (1 + (a * a - 1) * xi1));
    const sinTheta = Math.sqrt(Math.max(1 - cosTheta * cosTheta, 0));
    const hx = Math.cos(phi) * sinTheta;
    const hy = Math.sin(phi) * sinTheta;
    const hz = cosTheta;
    const vdoth = Math.max(vx * hx + vz * hz, 0);
    const lx = 2 * vdoth * hx - vx;
    const ly = 2 * vdoth * hy;
    const lz = 2 * vdoth * hz - vz;
    const length = Math.hypot(lx, ly, lz);
    if (length <= 0) continue;

    const ndotl = Math.max(lz / length, 0);
    const ndoth = Math.max(hz, 0);
    if (ndotl <= 0 || ndoth <= 0) continue;

    const g = geometrySchlickGgx(ndotl, roughness) * geometrySchlickGgx(ndotv, roughness);
    const gVis = (g * vdoth) / Math.max(ndoth * ndotv, 0.00001);
    const fc = (1 - vdoth) ** 5;
    scale += (1 - fc) * gVis;
    bias += fc * gVis;
  }

  return [scale / sampleCount, bias / sampleCount];
};

export const createIblBrdfLutTexture = (
  context: {
    readonly createTexture: () => WebGLTexture;
    readonly gl: WebGL2RenderingContext;
    readonly textureUnit: number;
  },
): WebGLTexture => {
  const gl = context.gl;
  const data = new Uint8Array(IBL_BRDF_LUT_SIZE * IBL_BRDF_LUT_SIZE * 4);
  for (let y = 0; y < IBL_BRDF_LUT_SIZE; y += 1) {
    const roughness = (y + 0.5) / IBL_BRDF_LUT_SIZE;
    for (let x = 0; x < IBL_BRDF_LUT_SIZE; x += 1) {
      const ndotv = (x + 0.5) / IBL_BRDF_LUT_SIZE;
      const [scale, bias] = integrateBrdf(roughness, ndotv);
      const offset = (y * IBL_BRDF_LUT_SIZE + x) * 4;
      data[offset] = Math.round(clamp01(scale) * 255);
      data[offset + 1] = Math.round(clamp01(bias) * 255);
      data[offset + 2] = 0;
      data[offset + 3] = 255;
    }
  }

  const texture = context.createTexture();
  gl.activeTexture(gl.TEXTURE0 + context.textureUnit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    IBL_BRDF_LUT_SIZE,
    IBL_BRDF_LUT_SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
};
