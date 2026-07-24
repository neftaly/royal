import type { TextureSourceEncoding } from "../texture/source";
import {
  fail,
  index,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

export type StaticTextureImageSource = Readonly<{
  expectedMimeType?: "image/avif" | "image/webp";
  imageIndex: number;
  sourceEncoding?: TextureSourceEncoding;
}>;

export type StaticTextureImagePlan = Readonly<{
  fallback?: StaticTextureImageSource;
  primary: StaticTextureImageSource;
  texture: JsonObject;
}>;

const isRequiredTextureSource = (
  extension: string,
  imageSource: JsonObject | undefined,
  required: ReadonlySet<unknown>,
  images: readonly unknown[],
  label: string,
  texturePath: string,
): boolean => {
  if (imageSource === undefined || !required.has(extension)) return false;
  index(
    imageSource.source,
    images,
    label,
    `${texturePath}.extensions.${extension}.source`,
  );
  return true;
};

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
    const avif = extensions.EXT_texture_avif === undefined
      ? undefined
      : object(extensions.EXT_texture_avif, label, `${texturePath}.extensions.EXT_texture_avif`);
    const hasRequiredAvif = isRequiredTextureSource(
      "EXT_texture_avif",
      avif,
      required,
      images,
      label,
      texturePath,
    );
    const hasRequiredEtc2 = isRequiredTextureSource(
      "GS_texture_etc2",
      etc2,
      required,
      images,
      label,
      texturePath,
    );
    const hasRequiredWebp = isRequiredTextureSource(
      "EXT_texture_webp",
      webp,
      required,
      images,
      label,
      texturePath,
    );
    const etc2HasPortableFallback = texture.source !== undefined
      || hasRequiredAvif
      || hasRequiredWebp;
    if (
      etc2 !== undefined
      && !required.has("GS_texture_etc2")
      && !etc2HasPortableFallback
    ) {
      fail(
        label,
        `${texturePath}.source`,
        "or a required lower-priority texture extension source is required when GS_texture_etc2 is optional",
      );
    }
    if (svg !== undefined && colorSpace !== "srgb") {
      fail(
        label,
        `${texturePath}.extensions.GS_texture_svg`,
        "is supported only for sRGB color texture slots",
      );
    }
    const svgHasPortableFallback = texture.source !== undefined
      || hasRequiredEtc2
      || hasRequiredAvif
      || hasRequiredWebp;
    if (
      svg !== undefined
      && !required.has("GS_texture_svg")
      && !svgHasPortableFallback
    ) {
      fail(
        label,
        `${texturePath}.source`,
        "or a required lower-priority texture extension source is required when GS_texture_svg is optional",
      );
    }
    if (
      avif !== undefined
      && texture.source === undefined
      && !required.has("EXT_texture_avif")
      && !hasRequiredWebp
    ) {
      fail(
        label,
        `${texturePath}.source`,
        "or a required lower-priority texture extension source is required when EXT_texture_avif is optional",
      );
    }
    if (
      webp !== undefined
      && texture.source === undefined
      && !required.has("EXT_texture_webp")
    ) {
      fail(
        label,
        `${texturePath}.source`,
        "is required when EXT_texture_webp is optional",
      );
    }
    const source = (
      value: unknown,
      path: string,
      sourceEncoding?: TextureSourceEncoding,
      expectedMimeType?: StaticTextureImageSource["expectedMimeType"],
    ): StaticTextureImageSource => ({
      ...(expectedMimeType === undefined ? {} : { expectedMimeType }),
      imageIndex: index(value, images, label, path),
      ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
    });
    const fallback = (): StaticTextureImageSource => etc2 !== undefined && etc2Available
      ? source(
        etc2.source,
        `${texturePath}.extensions.GS_texture_etc2.source`,
        "ktx2-etc2",
      )
      : avif !== undefined
        ? source(
          avif.source,
          `${texturePath}.extensions.EXT_texture_avif.source`,
          undefined,
          "image/avif",
        )
        : webp === undefined
          ? source(texture.source, `${texturePath}.source`)
          : source(
            webp.source,
            `${texturePath}.extensions.EXT_texture_webp.source`,
            undefined,
            "image/webp",
          );
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
