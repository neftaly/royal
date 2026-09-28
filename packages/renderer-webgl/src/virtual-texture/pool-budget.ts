export type VirtualTexturePoolBudgetRequest = Readonly<{
  key: string;
  minimumBytes: number;
  wantedBytes: number;
}>;

/** Reserve coarse coverage, then share remaining bytes equally up to demand. */
export const allocateVirtualTexturePoolBytes = (
  requests: readonly VirtualTexturePoolBudgetRequest[],
  budgetBytes: number,
): Map<string, number> => {
  const result = new Map<string, number>();
  let minimum = 0, pending = 0;
  for (const request of requests) {
    minimum += request.minimumBytes;
    if (request.wantedBytes > request.minimumBytes) pending += 1;
  }
  const scale = minimum > budgetBytes ? budgetBytes / minimum : 1;
  for (const request of requests) result.set(request.key, Math.floor(request.minimumBytes * scale));
  let remaining = Math.max(0, budgetBytes - minimum);
  while (remaining > 0 && pending > 0) {
    const previousCount = pending;
    pending = 0;
    const share = remaining / previousCount;
    let assigned = 0;
    for (const request of requests) {
      const previous = result.get(request.key)!;
      if (request.wantedBytes <= request.minimumBytes || previous >= request.wantedBytes) continue;
      const extra = Math.min(request.wantedBytes - previous, share);
      result.set(request.key, previous + extra);
      assigned += extra;
      if (previous + extra < request.wantedBytes) pending += 1;
    }
    remaining = Math.max(0, remaining - assigned);
    // Without a capped request the remainder was fully distributed; any
    // residual is floating-point error, not another useful allocation round.
    if (assigned === 0 || pending === previousCount) break;
  }
  for (const request of requests) result.set(request.key, Math.floor(result.get(request.key)!));
  return result;
};

/** Whole slots cannot be fractionally promised to more images than fit. */
export const allocateVirtualTextureSlots = (
  requests: readonly VirtualTexturePoolBudgetRequest[], slots: number,
): Map<string, number> => {
  const shares = allocateVirtualTexturePoolBytes(requests, slots);
  let remaining = slots - [...shares.values()].reduce((sum, value) => sum + value, 0);
  for (const request of [...requests].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) {
    if (remaining === 0) break;
    const share = shares.get(request.key)!;
    if (share >= request.wantedBytes) continue;
    shares.set(request.key, share + 1);
    remaining--;
  }
  return shares;
};

/** Visible demand wins; only surplus capacity is promised to reusable pages. */
export const allocateVirtualTexturePoolWithCache = (
  requests: readonly (VirtualTexturePoolBudgetRequest & { cachedBytes: number })[],
  budgetBytes: number,
): Map<string, number> => {
  const result = allocateVirtualTexturePoolBytes(requests, budgetBytes);
  const remaining = Math.max(0, budgetBytes - [...result.values()].reduce((sum, bytes) => sum + bytes, 0));
  const cache = allocateVirtualTexturePoolBytes(requests.map(request => ({
    key: request.key, minimumBytes: 0,
    wantedBytes: Math.max(0, request.cachedBytes - (result.get(request.key) ?? 0)),
  })), remaining);
  for (const [key, bytes] of cache) result.set(key, result.get(key)! + bytes);
  return result;
};
