/** Allocation-free candidate loop for the same conservative CSR research lists. */
export const buildViewListsFast = (lights, viewProjection, {
  columns = 16, rows = 16, byteBudget = 1024 * 1024,
} = {}) => {
  if (!Number.isSafeInteger(columns) || columns < 1 || !Number.isSafeInteger(rows) || rows < 1
    || !Number.isSafeInteger(byteBudget) || byteBudget < 0
    || viewProjection.length !== 16 || !Array.from(viewProjection).every(Number.isFinite)) throw new Error('Invalid tile-list input');
  const tileCount = columns * rows, headers = tileCount * 2;
  const availableWords = Math.floor(byteBudget / 4);
  if (!Number.isSafeInteger(tileCount) || headers > availableWords) return { kind: 'global', reason: 'budget' };
  const storage = new Uint32Array(Math.min(availableWords, headers + tileCount * lights.length));
  // Six unnormalized clip planes (xyzw + normal length), reused for each tile.
  const planes = new Float64Array(30);
  const writePlane = (offset, row, sign, wScale) => {
    for (let component = 0; component < 4; component++) planes[offset+component] = sign * viewProjection[row+component*4] + wScale * viewProjection[3+component*4];
    planes[offset+4] = Math.hypot(planes[offset],planes[offset+1],planes[offset+2]);
  };
  // Preserve reference addition order for near and far planes.
  for (let component = 0; component < 4; component++) {
    planes[20+component] = viewProjection[3+component*4] + viewProjection[2+component*4];
    planes[25+component] = viewProjection[3+component*4] - viewProjection[2+component*4];
  }
  planes[24] = Math.hypot(planes[20],planes[21],planes[22]);
  planes[29] = Math.hypot(planes[25],planes[26],planes[27]);
  let cursor = headers, maxCount = 0;
  for (let tileY = 0; tileY < rows; tileY++) {
    writePlane(10,1,1,-(2*tileY/rows-1)); writePlane(15,1,-1,2*(tileY+1)/rows-1);
    for (let tileX = 0; tileX < columns; tileX++) {
      writePlane(0,0,1,-(2*tileX/columns-1)); writePlane(5,0,-1,2*(tileX+1)/columns-1);
      const offset = cursor;
      candidate: for (let index = 0; index < lights.length; index++) {
        const light = lights[index], radius = light.range;
        if (light.kind !== 'directional' && radius > 0) {
          const position = light.position, px = position[0], py = position[1], pz = position[2];
          for (let plane = 0; plane < 30; plane += 5) {
            const distance = planes[plane]*px + planes[plane+1]*py + planes[plane+2]*pz + planes[plane+3];
            const reach = radius*planes[plane+4];
            if (distance < -reach - 1e-6*(Math.abs(distance)+reach+1)) continue candidate;
          }
        }
        if (cursor === storage.length) return { kind: 'global', reason: 'budget' };
        storage[cursor++] = index;
      }
      const count = cursor-offset, tile = tileY*columns+tileX;
      storage[tile*2] = offset; storage[tile*2+1] = count; maxCount = Math.max(maxCount,count);
    }
  }
  return { kind: 'tiled', columns, rows, words: storage.subarray(0,cursor), maxCount,
    meanCount: (cursor-headers)/tileCount, allocatedBytes: storage.byteLength, uploadBytes: cursor*4 };
};
