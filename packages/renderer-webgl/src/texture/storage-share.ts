/** Fair per-representation ceiling after fully funded small textures return their unused share. */
export const textureStorageShare = (
  budget: number,
  demands: readonly Readonly<{ bytes: number; copies: number }>[],
): number | undefined => {
  let copies = 0;
  for (const demand of demands) copies += demand.copies;
  if (copies === 0) return undefined;
  let remaining = budget;
  for (const demand of [...demands].sort((a, b) => a.bytes - b.bytes)) {
    if (demand.bytes * copies > remaining) break;
    remaining -= demand.bytes * demand.copies;
    copies -= demand.copies;
    if (copies === 0) return Math.max(4, demand.bytes);
  }
  return Math.max(4, Math.floor(remaining / copies));
};
