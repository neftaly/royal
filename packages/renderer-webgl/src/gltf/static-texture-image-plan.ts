import {
  fail,
  index,
  integer,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

export type StaticTextureImageSource = Readonly<{
  expectedMimeType?: "image/avif" | "image/webp" | "image/ktx2";
  imageIndex: number;
  sourceEncoding?: "ktx2-astc";
}>;

export type StaticTextureImagePlan = Readonly<{
  astc?: StaticTextureImageSource;
  rasterPreview?: Readonly<{ width: number; height: number }>;
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

/** Pure extension-aware image selection shared by transport demand and preparation. */
export const createStaticTextureImagePlanner = (
  document: JsonObject,
  label: string,
): ((textureIndex: number) => StaticTextureImagePlan) => {
  const images = optionalArray(document.images, label, "images");
  const textures = optionalArray(document.textures, label, "textures");
  const required = new Set(optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  ));
  return (textureIndex) => {
    const texturePath = `textures[${textureIndex}]`;
    const texture = object(textures[textureIndex], label, texturePath);
    const extensions = texture.extensions === undefined
      ? {}
      : object(texture.extensions, label, `${texturePath}.extensions`);
    const astc = extensions.EXT_texture_astc === undefined
      ? undefined
      : object(extensions.EXT_texture_astc, label, `${texturePath}.extensions.EXT_texture_astc`);
    const requiredAstc = astc !== undefined && required.has("EXT_texture_astc");
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
    const hasRequiredWebp = isRequiredTextureSource(
      "EXT_texture_webp",
      webp,
      required,
      images,
      label,
      texturePath,
    );
    const extras = texture.extras;
    const royal = typeof extras === "object" && extras !== null && !Array.isArray(extras)
      ? (extras as JsonObject).royal : undefined;
    const preview = typeof royal === "object" && royal !== null && !Array.isArray(royal)
      ? (royal as JsonObject).astcPreview : undefined;
    let rasterPreview: StaticTextureImagePlan["rasterPreview"];
    if (preview !== undefined) {
      const path = `${texturePath}.extras.royal.astcPreview`;
      const value = object(preview, label, path);
      const width = integer(value.width, label, `${path}.width`);
      const height = integer(value.height, label, `${path}.height`);
      if (astc === undefined || requiredAstc || width < 1 || height < 1 || width > 16384 || height > 16384) {
        fail(label, path, "requires optional ASTC, a full raster source, dimensions from 1 to 16384");
      }
      rasterPreview = { width, height };
    }
    if (astc !== undefined && texture.source === undefined && !requiredAstc
      && !hasRequiredAvif && !hasRequiredWebp) {
      fail(label, `${texturePath}.source`, "or a required supported source extension is required when EXT_texture_astc is optional");
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
      sourceEncoding?: "ktx2-astc",
      expectedMimeType?: StaticTextureImageSource["expectedMimeType"],
    ): StaticTextureImageSource => ({
      ...(expectedMimeType === undefined ? {} : { expectedMimeType }),
      imageIndex: index(value, images, label, path),
      ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
    });
    const native = astc === undefined ? undefined : source(
      astc.source, `${texturePath}.extensions.EXT_texture_astc.source`, "ktx2-astc", "image/ktx2",
    );
    const fallback = (): StaticTextureImageSource => requiredAstc ? native! : avif !== undefined
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
    const alternative = native === undefined || requiredAstc ? {} : { astc: native };
    return { primary: fallback(), texture, ...alternative,
      ...(rasterPreview === undefined ? {} : { rasterPreview }) };
  };
};
