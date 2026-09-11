/**
 * Research-only conservative tile frusta. No depth-buffer reduction: transparent
 * fragments at every depth participate. Clip planes work for perspective and
 * orthographic projections, including asymmetric stereo projections.
 *
 * Input order is canonical light order. Missing/zero range and directional
 * records remain in every tile. On storage exhaustion the caller must use the
 * exact global loop; there is no per-tile light cap.
 */
export const buildViewLists = (lights, viewProjection, {
  columns = 16, rows = 16, byteBudget = 1024 * 1024,
} = {}) => {
  if (!Number.isSafeInteger(columns) || columns < 1 || !Number.isSafeInteger(rows) || rows < 1
    || !Number.isSafeInteger(byteBudget) || byteBudget < 0
    || viewProjection.length !== 16 || !Array.from(viewProjection).every(Number.isFinite)) throw new Error('Invalid tile-list input');
  const tileCount = columns * rows;
  const headers = tileCount * 2;
  const availableWords = Math.floor(byteBudget / 4);
  if (!Number.isSafeInteger(tileCount) || headers > availableWords) return { kind: 'global', reason: 'budget' };
  const storage = new Uint32Array(Math.min(availableWords, headers + tileCount * lights.length));
  const row = index => [viewProjection[index], viewProjection[index + 4], viewProjection[index + 8], viewProjection[index + 12]];
  const x = row(0), y = row(1), z = row(2), w = row(3);
  const plane = (a, b, scale) => {
    const p = a.map((value, i) => value + b[i] * scale);
    return [...p, Math.hypot(p[0], p[1], p[2])];
  };
  const negative = values => values.map(value => -value);
  const near = plane(w, z, 1), far = plane(w, z, -1);
  let cursor = headers, maxCount = 0;
  for (let tileY = 0; tileY < rows; tileY++) for (let tileX = 0; tileX < columns; tileX++) {
    const left = 2 * tileX / columns - 1, right = 2 * (tileX + 1) / columns - 1;
    const bottom = 2 * tileY / rows - 1, top = 2 * (tileY + 1) / rows - 1;
    const planes = [plane(x, w, -left), plane(negative(x), w, right), plane(y, w, -bottom), plane(negative(y), w, top), near, far];
    const offset = cursor;
    for (let index = 0; index < lights.length; index++) {
      const light = lights[index];
      const radius = light.range;
      if (light.kind !== 'directional' && radius > 0) {
        const [px, py, pz] = light.position;
        // Scale-aware slack retains tangencies despite floating-point roundoff.
        if (planes.some(p => {
          const distance = p[0] * px + p[1] * py + p[2] * pz + p[3];
          return distance < -radius * p[4] - 1e-6 * (Math.abs(distance) + radius * p[4] + 1);
        })) continue;
      }
      if (cursor === storage.length) return { kind: 'global', reason: 'budget' };
      storage[cursor++] = index;
    }
    const count = cursor - offset;
    const tile = tileY * columns + tileX;
    storage[tile * 2] = offset;
    storage[tile * 2 + 1] = count;
    maxCount = Math.max(maxCount, count);
  }
  return { kind: 'tiled', columns, rows, words: storage.subarray(0, cursor), maxCount,
    meanCount: (cursor - headers) / tileCount, allocatedBytes: storage.byteLength, uploadBytes: cursor * 4 };
};
