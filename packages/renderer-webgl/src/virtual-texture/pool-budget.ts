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
  const minimum = requests.reduce((sum, request) => sum + request.minimumBytes, 0);
  const scale = minimum > budgetBytes ? budgetBytes / minimum : 1;
  for (const request of requests) result.set(request.key, Math.floor(request.minimumBytes * scale));
  let remaining = Math.max(0, budgetBytes - minimum);
  let pending = requests.filter((request) => request.wantedBytes > request.minimumBytes);
  while (remaining > 0 && pending.length > 0) {
    const previousCount = pending.length;
    const share = remaining / previousCount;
    let assigned = 0;
    for (const request of pending) {
      const previous = result.get(request.key)!;
      const extra = Math.min(request.wantedBytes - previous, share);
      result.set(request.key, previous + extra);
      assigned += extra;
    }
    remaining = Math.max(0, remaining - assigned);
    pending = pending.filter((request) => result.get(request.key)! < request.wantedBytes);
    // Without a capped request the remainder was fully distributed; any
    // residual is floating-point error, not another useful allocation round.
    if (assigned === 0 || pending.length === previousCount) break;
  }
  for (const [key, bytes] of result) result.set(key, Math.floor(bytes));
  return result;
};
