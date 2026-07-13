export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const copyNumberCounters = (value: unknown): Record<string, number> | null => {
  if (!isRecord(value)) return null;

  const counters: Record<string, number> = {};
  for (const [key, counter] of Object.entries(value)) {
    if (typeof counter === 'number' && Number.isFinite(counter)) counters[key] = counter;
  }

  return Object.keys(counters).length === 0 ? null : counters;
};

export const copyVirtualTexturingCounters = (value: unknown): Record<string, number> | null => {
  const counters = copyNumberCounters(value) ?? {};
  if (isRecord(value)) {
    const flattenPagesByMip = (
      pagesByMip: unknown,
      prefix: 'activePagesMip' | 'cachedPagesMip' | 'residentPagesMip',
    ): void => {
      if (!Array.isArray(pagesByMip)) return;
      for (const [mip, pages] of pagesByMip.entries()) {
        if (typeof pages === 'number' && Number.isFinite(pages)) counters[`${prefix}${mip}`] = pages;
      }
    };

    flattenPagesByMip(value.activePagesByMip, 'activePagesMip');
    flattenPagesByMip(value.residentPagesByMip, 'residentPagesMip');
    // Resident pages are the reusable cache. Keep the legacy resident names in
    // reports while exposing the active-vs-cached distinction to smoke tests.
    flattenPagesByMip(value.residentPagesByMip, 'cachedPagesMip');
    if (Array.isArray(value.cachedPagesByMip)) {
      flattenPagesByMip(value.cachedPagesByMip, 'cachedPagesMip');
    }
  }
  return Object.keys(counters).length === 0 ? null : counters;
};
