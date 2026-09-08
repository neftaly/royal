import type { ParsedSvgTextureSource } from "../texture/svg-source";
const UNIT_SCALE: Readonly<Record<string, number>> = { "": 1, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
const absoluteLength = (value: string | null): number | undefined => {
  const match = value?.trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)$/iu);
  if (!match) return undefined;
  const length = Number(match[1]) * (UNIT_SCALE[match[2]!.toLowerCase()] ?? NaN);
  return Number.isFinite(length) && length > 0 ? length : undefined;
};
let cssIntrinsicSize: Promise<boolean> | undefined;
const honorsCssIntrinsicSize = (): Promise<boolean> => cssIntrinsicSize ??= (async () => {
  const image = new Image();
  const uri = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1" style="width:1px;height:1px"/>'], { type: "image/svg+xml" }));
  image.src = uri;
  try { await image.decode(); return image.naturalWidth === 1; }
  finally { image.removeAttribute("src"); URL.revokeObjectURL(uri); }
})();

export const svgRasterViewport = async (source: ParsedSvgTextureSource): Promise<readonly [number, number]> => {
  const root = source.document.documentElement as unknown as SVGSVGElement;
  const cssWidth = root.style?.getPropertyValue("width");
  const cssHeight = root.style?.getPropertyValue("height");
  const css = (cssWidth || cssHeight) && await honorsCssIntrinsicSize();
  const width = absoluteLength((css && cssWidth) || root.getAttribute("width"));
  const height = absoluteLength((css && cssHeight) || root.getAttribute("height"));
  const [, , vw, vh] = source.viewBox;
  if (width !== undefined && height !== undefined) return [width, height];
  if (width !== undefined) return [width, width * vh / vw];
  if (height !== undefined) return [height * vw / vh, height];
  return [vw, vh];
};
