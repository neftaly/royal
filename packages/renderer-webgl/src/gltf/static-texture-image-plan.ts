import type { TextureSourceEncoding } from "../texture/source";
import {
  fail,
  index,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

export type StaticTextureImageSource = Readonly<{
  imageIndex: number;
  sourceEncoding?: TextureSourceEncoding;
}>;

export type StaticTextureImagePlan = Readonly<{
  fallback?: StaticTextureImageSource;
  primary: StaticTextureImageSource;
  texture: JsonObject;
}>;

/** Pure capability-aware image selection shared by transport demand and preparation. */
export const createStaticTextureImagePlanner = (
  document: JsonObject,
  label: string,
  etc2Available: boolean,
): ((textureIndex: number, colorSpace: "linear" | "srgb") => StaticTextureImagePlan) => {
  const images = optionalArray(document.images, label, "images");
  const textures = optionalArray(document.textures, label, "textures");
  const required = new Set(optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  ));
  return (textureIndex, colorSpace) => {
    const texturePath = `textures[${textureIndex}]`;
    const texture = object(textures[textureIndex], label, texturePath);
    const extensions = texture.extensions === undefined
      ? {}
      : object(texture.extensions, label, `${texturePath}.extensions`);
    const etc2 = extensions.GS_texture_etc2 === undefined
      ? undefined
      : object(extensions.GS_texture_etc2, label, `${texturePath}.extensions.GS_texture_etc2`);
    const svg = extensions.GS_texture_svg === undefined
      ? undefined
      : object(extensions.GS_texture_svg, label, `${texturePath}.extensions.GS_texture_svg`);
    const webp = extensions.EXT_texture_webp === undefined
      ? undefined
      : object(extensions.EXT_texture_webp, label, `${texturePath}.extensions.EXT_texture_webp`);
    if (etc2 !== undefined && texture.source === undefined && !required.has("GS_texture_etc2")) {
      fail(
        label,
        `${texturePath}.source`,
        "is required when optional GS_texture_etc2 needs a core fallback",
      );
    }
    if (svg !== undefined && colorSpace !== "srgb") {
      fail(
        label,
        `${texturePath}.extensions.GS_texture_svg`,
        "is supported only for sRGB color texture slots",
      );
    }
    if (svg !== undefined && texture.source === undefined && !required.has("GS_texture_svg")) {
      fail(
        label,
        `${texturePath}.source`,
        "is required when optional GS_texture_svg needs a core raster fallback",
      );
    }
    const source = (
      value: unknown,
      path: string,
      sourceEncoding?: TextureSourceEncoding,
    ): StaticTextureImageSource => ({
      imageIndex: index(value, images, label, path),
      ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
    });
    const fallback = (): StaticTextureImageSource => etc2 !== undefined && etc2Available
      ? source(
        etc2.source,
        `${texturePath}.extensions.GS_texture_etc2.source`,
        "ktx2-etc2",
      )
      : webp === undefined
        ? source(texture.source, `${texturePath}.source`)
        : source(webp.source, `${texturePath}.extensions.EXT_texture_webp.source`);
    if (svg === undefined) return { primary: fallback(), texture };
    const primary = source(
      svg.source,
      `${texturePath}.extensions.GS_texture_svg.source`,
      "svg",
    );
    return required.has("GS_texture_svg")
      ? { primary, texture }
      : { fallback: fallback(), primary, texture };
  };
};
