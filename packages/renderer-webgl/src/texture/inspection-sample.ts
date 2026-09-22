import { reduceInspectionRgba, type InspectionReduction, type InspectionRgba } from "./inspection-rgba";
import type { InspectionReductionWorker } from "./inspection-reduction";
import type { DecodedImageTextureSource, DecodedTextureSource } from "./source";
import { InspectionReadback, type InspectionReadbackSource } from "./inspection-readback";

const SIZE = 256;
const canvas = (width: number, height: number): HTMLCanvasElement => {
  const value = document.createElement("canvas");
  value.width = width; value.height = height;
  return value;
};

/** Freeze mutable/vector-capable browser sources before either inspection or display. */
export const freezeInspectionSource = (source: DecodedImageTextureSource): DecodedImageTextureSource => {
  if (typeof ImageBitmap !== "undefined" && source.source instanceof ImageBitmap) return source;
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width * source.height * 4 > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection raster exceeds its 64 MiB limit");
  const image = canvas(source.width, source.height);
  try {
    const context = image.getContext("2d");
    if (context === null) throw new Error("Royal texture inspection could not freeze image pixels");
    if (typeof ImageData !== "undefined" && source.source instanceof ImageData) context.putImageData(source.source, 0, 0);
    else context.drawImage(source.source as CanvasImageSource, 0, 0, source.width, source.height);
    context.getImageData(0, 0, 1, 1);
    source.close?.();
    return { ...source, source: image, close: () => { image.width = 1; image.height = 1; } };
  } catch (error) { image.width = 1; image.height = 1; throw error; }
};

/** Private offscreen RGB sampling; never touches the renderer's presentation state. */
export class TextureInspectionSampler {
  readonly #readback = new InspectionReadback(() => canvas(1, 1));
  #disposed = false;
  #reduction: InspectionReductionWorker | undefined;

  sample(source: DecodedTextureSource, mip = 0): HTMLCanvasElement {
    const images = this.samples(source, mip);
    for (const extra of images.slice(1)) { extra.width = 1; extra.height = 1; }
    return images[0]!;
  }

  samples(source: DecodedTextureSource, mip = 0): HTMLCanvasElement[] {
    const input = this.#input(source, mip);
    return this.#images(input.width, input.height, reduceInspectionRgba(input));
  }

  async samplesAsync(source: DecodedTextureSource, mip: number, signal: AbortSignal): Promise<HTMLCanvasElement[]> {
    this.#check(signal);
    const input = this.#source(source, mip);
    const dimensions = this.#dimensions(input.width, input.height);
    let reduction: InspectionReduction | undefined;
    if (input.width * input.height > 256 * 256) {
      // Clone without premultiplication; transfer only the owned temporary bitmap.
      // createImageBitmap is cheaper than structured-cloning a large borrowed bitmap.
      const temporary = input.source !== undefined
        ? await createImageBitmap(input.source as ImageBitmapSource, { premultiplyAlpha: "none", colorSpaceConversion: "none" }) : undefined;
      try {
        this.#check(signal);
        await this.#worker(signal);
        const workerInput: InspectionReadbackSource = input.source !== undefined
          ? { ...input, source: temporary ?? input.source }
          : { ...input, blocks: input.blocks.slice() };
        const transfer = temporary !== undefined ? [temporary]
          : workerInput.source === undefined ? [workerInput.blocks.buffer] : [];
        reduction = await this.#reduction!.sample(workerInput, dimensions, transfer, signal);
      } finally { temporary?.close(); }
      this.#check(signal);
    }
    if (reduction === undefined) {
      const rgba = this.#readback.read(input);
      const pixels = { rgba, ...dimensions };
      reduction = rgba.length <= 256 * 256 * 4 ? reduceInspectionRgba(pixels)
        : await (await this.#worker(signal)).reduce(pixels, signal);
    }
    this.#check(signal);
    return this.#images(dimensions.width, dimensions.height, reduction);
  }

  async #worker(signal: AbortSignal): Promise<InspectionReductionWorker> {
    const { InspectionReductionWorker } = await import("./inspection-reduction");
    this.#check(signal);
    return this.#reduction ??= new InspectionReductionWorker();
  }

  #check(signal?: AbortSignal): void {
    if (this.#disposed || signal?.aborted) throw new DOMException("Texture inspection was aborted", "AbortError");
  }

  #dimensions(inputWidth: number, inputHeight: number): Omit<InspectionRgba, "rgba"> {
    if (!Number.isSafeInteger(inputWidth) || !Number.isSafeInteger(inputHeight) || inputWidth < 1 || inputHeight < 1) {
      throw new TypeError("Royal texture inspection requires positive image dimensions");
    }
    if (inputWidth * inputHeight * 4 > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection raster exceeds its 64 MiB limit");
    const scale = Math.min(1, SIZE / Math.max(inputWidth, inputHeight));
    return { inputWidth, inputHeight, width: Math.max(1, Math.round(inputWidth * scale)), height: Math.max(1, Math.round(inputHeight * scale)) };
  }

  #source(source: DecodedTextureSource, mip: number): InspectionReadbackSource {
    if (source.kind === undefined) return { width: source.width, height: source.height, source: source.source };
    const level = source.levels[mip];
    if (level === undefined) throw new Error("Royal texture inspection requires a mip level");
    if (level.blocks.byteLength > 64 * 1024 * 1024) throw new RangeError("Royal texture inspection sampling storage exceeds its 64 MiB limit");
    return { width: level.width, height: level.height, blocks: level.blocks, mip,
      format: source.kind === "ktx2-etc2" ? "etc2-rgba" : source.format };
  }

  #input(source: DecodedTextureSource, mip: number): InspectionRgba {
    this.#check();
    const input = this.#source(source, mip);
    const dimensions = this.#dimensions(input.width, input.height);
    return { rgba: this.#readback.read(input), ...dimensions };
  }

  #images(width: number, height: number, { reduced, transparent }: InspectionReduction): HTMLCanvasElement[] {
    // Keep raw RGB (opaque materials) and black/white composites (blended materials).
    const images: HTMLCanvasElement[] = [];
    try {
      for (let view = 0; view < (transparent ? 3 : 1); view++) {
        const image = canvas(width, height); images.push(image);
        const context = image.getContext("2d");
        if (context === null) throw new Error("Royal texture inspection could not create a sample canvas");
        const pixels = context.createImageData(width, height);
        for (let i = 0; i < width * height; i++) {
          for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = reduced[i * 7 + c + (view === 0 ? 0 : 3)]! + (view === 2 ? reduced[i * 7 + 6]! : 0);
          pixels.data[i * 4 + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
      }
      return images;
    } catch (error) {
      for (const image of images) { image.width = 1; image.height = 1; }
      throw error;
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#reduction?.dispose();
    this.#readback.dispose();
  }

}

/** Cache the actual inspected pixels, including dimensions, rather than trusting a URI alone. */
export const inspectionSampleKey = async (image: HTMLCanvasElement): Promise<string> => {
  const context = image.getContext("2d");
  if (context === null) throw new Error("Royal texture inspection could not read sample pixels");
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", pixels));
  return `${image.width}x${image.height}:` + Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
};
