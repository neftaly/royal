import { environmentInspectionPixels } from "./inspection-pixels";
import type { TextureInspector } from "../texture/inspection-policy";
import type { PreparedRoyalEnvironment } from "./royal-environment-ktx1";

/** One bounded contact sheet of all six HDR faces at the requested roughness mip. */
export const environmentInspectionSample = (source: PreparedRoyalEnvironment, mip = 0): HTMLCanvasElement => {
  const { width, height, rgba } = environmentInspectionPixels(source, mip);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Royal texture inspection could not create an environment overview");
  const pixels = context.createImageData(width, height);
  pixels.data.set(rgba);
  context.putImageData(pixels, 0, 0);
  return canvas;
};

/** Authored roughness levels are independent input and each must pass inspection. */
export const inspectEnvironment = async (
  inspector: TextureInspector,
  key: string,
  source: PreparedRoyalEnvironment,
  signal: AbortSignal,
): Promise<void> => {
  if (source.levels.length === 0) throw new Error("Royal texture inspection requires environment faces");
  for (let mip = 0; mip < source.levels.length; mip++) {
    await inspector.inspectPixels("environment:" + key, async () => environmentInspectionSample(source, mip), signal);
  }
};
