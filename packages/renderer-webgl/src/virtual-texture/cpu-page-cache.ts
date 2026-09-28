import type { VirtualTexturePageKey } from "./residency";

type Entry = { owner: object; key: VirtualTexturePageKey; pixels: ImageData; bytes: number };

/** Retains existing CPU pixels only: no GPU readback, copying, or native handles. */
export class CpuVirtualTexturePageCache {
  readonly limitBytes: number;
  readonly #owners = new Map<object, Map<VirtualTexturePageKey, Entry>>();
  readonly #lru = new Set<Entry>();
  bytes = 0;
  hits = 0;

  constructor(limitBytes = 16 * 1024 * 1024) { this.limitBytes = limitBytes; }

  has(owner: object, key: VirtualTexturePageKey): boolean {
    return this.#owners.get(owner)?.has(key) === true;
  }

  get(owner: object, key: VirtualTexturePageKey): ImageData | undefined {
    const entry = this.#owners.get(owner)?.get(key);
    if (entry === undefined) return undefined;
    this.#lru.delete(entry); this.#lru.add(entry);
    this.hits++;
    return entry.pixels;
  }

  set(owner: object, key: VirtualTexturePageKey, pixels: ImageData): void {
    const previous = this.#owners.get(owner)?.get(key);
    if (previous !== undefined) this.#remove(previous);
    const bytes = pixels.data.byteLength;
    if (bytes === 0 || bytes > this.limitBytes) return;
    while (this.bytes + bytes > this.limitBytes) this.#remove(this.#lru.values().next().value!);
    let pages = this.#owners.get(owner);
    if (pages === undefined) { pages = new Map(); this.#owners.set(owner, pages); }
    const entry = { owner, key, pixels, bytes };
    pages.set(key, entry); this.#lru.add(entry); this.bytes += bytes;
  }

  deleteOwner(owner: object): void {
    for (const entry of this.#owners.get(owner)?.values() ?? []) this.#remove(entry);
  }

  clear(): void { this.#owners.clear(); this.#lru.clear(); this.bytes = 0; }

  #remove(entry: Entry): void {
    this.#lru.delete(entry); this.bytes -= entry.bytes;
    const pages = this.#owners.get(entry.owner)!;
    pages.delete(entry.key);
    if (pages.size === 0) this.#owners.delete(entry.owner);
  }
}
