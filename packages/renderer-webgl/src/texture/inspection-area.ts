/** Area integration: every source texel contributes, including non-power-of-two edges. */
export const inspectionArea = (
  width: number, height: number, outWidth: number, outHeight: number, channels: number,
  read: (x: number, y: number, values: Float64Array) => void,
): Float64Array => {
  const result = new Float64Array(outWidth * outHeight * channels);
  const values = new Float64Array(channels);
  const sx = width / outWidth, sy = height / outHeight;
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const left = x * sx, right = (x + 1) * sx, top = y * sy, bottom = (y + 1) * sy;
    const offset = (y * outWidth + x) * channels;
    for (let iy = Math.floor(top); iy < Math.min(height, Math.ceil(bottom)); iy++) {
      const wy = Math.min(bottom, iy + 1) - Math.max(top, iy);
      for (let ix = Math.floor(left); ix < Math.min(width, Math.ceil(right)); ix++) {
        const weight = wy * (Math.min(right, ix + 1) - Math.max(left, ix)) / (sx * sy);
        read(ix, iy, values);
        for (let c = 0; c < channels; c++) result[offset + c]! += values[c]! * weight;
      }
    }
  }
  return result;
};
