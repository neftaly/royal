import { selectVirtualTexturePoolSlot, type VirtualTexturePoolSlot } from '../../packages/renderer-webgl/src/virtual-texture/residency';
const cases = [1, 8, 64].map(count => {
  const slots: (VirtualTexturePoolSlot | undefined)[] = new Array(3600);
  const owned = new Map<number, number>();
  const frames = new Uint32Array(slots.length);
  for (let i = 0; i < count; i++) { const slot = i * 4; slots[slot] = { resourceKey: 'owner', pageKey: i }; owned.set(i, slot); frames[slot] = i + 1; }
  return { count, slots, owned, frames, protectedPages: { has: (_resource: string, page: number | string) => page !== count - 1 } };
});
let checksum = 0;
const run = (value: typeof cases[number], calls: number) => {
  for (let i = 0; i < calls; i++) checksum += selectVirtualTexturePoolSlot('owner', -1,
    value.slots, value.frames, value.protectedPages, value.owned);
};
export function prepareResidentSlots() {
  for (const value of cases) {
    if (selectVirtualTexturePoolSlot('owner', -1, value.slots, value.frames, value.protectedPages, value.owned) !== (value.count - 1) * 4)
      throw new Error('Capped slot choice escaped its owner or evicted a protected page');
    run(value, 100000);
  }
}
export function runResidentSlots() {
  const results = [];
  for (let round = 0; round < 8; round++) for (const value of cases) {
    const start = performance.now(); run(value, 100000);
    results.push({ count: value.count, round, calls: 100000, elapsedMs: performance.now() - start });
  }
  return { results, checksum, note: '2.4 million capped slot choices after 300,000 warm-up calls, using persistent fixture maps and arrays. No rendering, transport, frame scheduling or GPU upload. Host GPU is only the runner capability probe.' };
}
