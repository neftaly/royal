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
