import type { DecodedImageTextureSource } from "../texture/source";

type Entry = {
  bytes: number;
  discard: boolean;
  users: number;
  image?: DecodedImageTextureSource;
  pending: Promise<DecodedImageTextureSource>;
};

/** Root-local decoded SVG storage, including reservations for in-flight rasters. */
export class SvgRasterCache {
  readonly #entries = new Map<object, Entry>();
  readonly #limit: number;
  #bytes = 0;

  constructor(limit = 4 * 1024 * 1024) {
    this.#limit = limit;
  }

  get byteLength(): number { return this.#bytes; }

  has(key: object): boolean {
    const entry = this.#entries.get(key);
    return entry?.image !== undefined && !entry.discard;
  }

  delete(key: object): void {
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.discard = true;
    if (entry.users > 0) return;
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    entry.image?.close?.();
  }

  clear(): void {
    for (const key of this.#entries.keys()) this.delete(key);
  }

  async use<T>(
    key: object,
    bytes: number,
    prepare: () => Promise<DecodedImageTextureSource>,
    consume: (image: DecodedImageTextureSource) => T,
  ): Promise<T | undefined> {
    let entry = this.#entries.get(key);
    if (entry?.discard) return undefined;
    if (entry === undefined) {
      if (bytes > this.#limit) return undefined;
      for (const [candidate, value] of this.#entries) {
        if (this.#bytes + bytes <= this.#limit) break;
        if (value.users === 0) this.delete(candidate);
      }
      if (this.#bytes + bytes > this.#limit) return undefined;
      this.#bytes += bytes;
      entry = { bytes, discard: false, users: 0, pending: Promise.resolve().then(prepare) };
      this.#entries.set(key, entry);
    }
    // Active users pin storage through decode and synchronous page copying.
    entry.users += 1;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    try {
      entry.image = await entry.pending;
      return consume(entry.image);
    } catch (error) {
      entry.discard = true;
      throw error;
    } finally {
      entry.users -= 1;
      if (entry.discard) this.delete(key);
    }
  }
}
