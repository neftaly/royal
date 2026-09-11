/** Research-only orthographic tile lists. No per-tile truncation. */
export const buildPlaneLists = (data, count, tiles = 16) => {
  const stride = count + 1;
  const indices = new Uint32Array(tiles * tiles * stride);
  let memberships = 0, maxCount = 0;
  for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) {
    const base = (y * tiles + x) * stride;
    let length = 0;
    const loX = x / tiles * 8 - 4, hiX = (x + 1) / tiles * 8 - 4;
    const loY = y / tiles * 8 - 4, hiY = (y + 1) / tiles * 8 - 4;
    for (let light = 0; light < count; light++) {
      const offset = light * 16;
      const range = data[offset + 11];
      if (data[offset + 3] !== 0 && range > 0) {
        // Orthographic XY projection of the full light sphere, conservative
        // for *all* fragment depths (including transparent surfaces).
        const dx = Math.max(loX - data[offset + 8], 0, data[offset + 8] - hiX);
        const dy = Math.max(loY - data[offset + 9], 0, data[offset + 9] - hiY);
        if (dx * dx + dy * dy > range * range) continue;
      }
      indices[base + 1 + length++] = light;
    }
    indices[base] = length;
    memberships += length;
    maxCount = Math.max(maxCount, length);
  }
  return { indices, memberships, maxCount, meanCount: memberships / (tiles * tiles), stride, tiles };
};

export const fixture = (kind, count) => {
  const data = new Float32Array(Math.max(1, count) * 16);
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const directional = kind === 'directional' || (kind === 'mixed' && i % 5 === 0);
    const spot = !directional && i % 3 === 0;
    const sparse = kind === 'sparse' || kind === 'mixed';
    const range = sparse ? 0.7 : kind === 'unbounded' ? 0 : 12;
    const energy = kind === 'tail' ? (i === count - 1 ? 1 : 0) : directional ? 0.7 / Math.max(count, 1) : sparse ? 0.06 : 2 / Math.max(count, 1);
    const dx = (random() - 0.5) * 0.3, dy = (random() - 0.5) * 0.3;
    const length = Math.hypot(dx, dy, -1);
    data.set([
      energy * (0.3 + random() * 0.7), energy * (0.3 + random() * 0.7), energy * (0.3 + random() * 0.7), directional ? 0 : spot ? 2 : 1,
      dx / length, dy / length, -1 / length, 0,
      (random() - 0.5) * (sparse ? 10 : 4), (random() - 0.5) * (sparse ? 10 : 4), sparse ? 0.3 : 2, range,
      Math.cos(0.3), Math.cos(0.6), 0, 0,
    ], i * 16);
  }
  return data;
};
