import type { GltfDocument, GltfImage } from "./schema";

export const supportedGltfExtensions = new Set<string>([
  "EXT_meshopt_compression",
  "EXT_lights_image_based",
  "EXT_mesh_gpu_instancing",
  "EXT_texture_webp",
  "KHR_draco_mesh_compression",
  "KHR_meshopt_compression",
  "KHR_texture_basisu",
  "KHR_lights_punctual",
  "KHR_materials_anisotropy",
  "KHR_materials_clearcoat",
  "KHR_materials_dispersion",
  "KHR_materials_diffuse_transmission",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_iridescence",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_unlit",
  "KHR_materials_volume",
  "KHR_materials_variants",
  "KHR_mesh_quantization",
  "KHR_texture_transform",
  "MSFT_lod",
  "GS_texture_svg",
]);

export class UnsupportedRequiredGltfExtensionError extends Error {
  readonly extensions: readonly string[];
  readonly src: string;

  constructor(src: string, extensions: readonly string[]) {
    const formatted = extensions.join(", ");
    super(`unsupported required glTF extension${extensions.length === 1 ? "" : "s"} for ${src}: ${formatted}`);
    this.name = "UnsupportedRequiredGltfExtensionError";
    this.extensions = extensions;
    this.src = src;
  }
}

const uniqueStrings = (values: readonly string[] | undefined): readonly string[] =>
  [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string"))];

export const unsupportedRequiredGltfExtensions = (
  document: GltfDocument,
  supportedExtensions: ReadonlySet<string> = supportedGltfExtensions,
): readonly string[] =>
  uniqueStrings(document.extensionsRequired)
    .filter((extension) => !supportedExtensions.has(extension));

export const assertSupportedRequiredGltfExtensions = (
  src: string,
  document: GltfDocument,
  supportedExtensions: ReadonlySet<string> = supportedGltfExtensions,
): void => {
  const unsupported = unsupportedRequiredGltfExtensions(document, supportedExtensions);
  if (unsupported.length > 0) throw new UnsupportedRequiredGltfExtensionError(src, unsupported);
  assertNoUnsupportedDeformation(src, document);
  assertRequiredTextureSourceExtensions(src, document);
  assertGsTextureSvgReferences(src, document);
};

const assertNoUnsupportedDeformation = (src: string, document: GltfDocument): void => {
  const skinnedNodeIndex = (document.nodes ?? []).findIndex((node) => node.skin !== undefined);
  if (skinnedNodeIndex >= 0) {
    throw new Error(`glTF node ${skinnedNodeIndex} in ${src} requires unsupported skeletal deformation`);
  }
  for (const [meshIndex, mesh] of (document.meshes ?? []).entries()) {
    const primitiveIndex = (mesh.primitives ?? []).findIndex((primitive) => (primitive.targets?.length ?? 0) > 0);
    if (primitiveIndex >= 0) {
      throw new Error(`glTF mesh ${meshIndex} primitive ${primitiveIndex} in ${src} requires unsupported morph deformation`);
    }
  }
};

const hasExtension = (
  extensions: readonly string[] | undefined,
  extension: string,
): boolean => uniqueStrings(extensions).includes(extension);

const isDataUri = (uri: string): boolean => /^data:/iu.test(uri);

const dataUriMediaType = (uri: string): string | undefined => {
  const match = /^data:([^,]*),/isu.exec(uri);
  return match?.[1]?.split(";")[0]?.toLowerCase();
};

const isSvgMimeType = (value: string | undefined): boolean =>
  value?.toLowerCase() === "image/svg+xml";

const isSvgUri = (uri: string): boolean => /\.svg(?:$|[?#])/iu.test(uri);

const imageLooksSvg = (image: GltfImage): boolean => {
  if (isSvgMimeType(image.mimeType)) return true;
  if (image.uri === undefined) return false;
  if (isDataUri(image.uri)) return isSvgMimeType(dataUriMediaType(image.uri));
  return isSvgUri(image.uri);
};

const requiredTextureSourceExtensions = [
  "EXT_texture_webp",
  "KHR_texture_basisu",
] as const;

const assertRequiredTextureSourceExtensions = (src: string, document: GltfDocument): void => {
  const textures = document.textures ?? [];
  const required = new Set(uniqueStrings(document.extensionsRequired));
  for (const [textureIndex, texture] of textures.entries()) {
    if (texture.source === undefined) continue;
    for (const extension of requiredTextureSourceExtensions) {
      if (!required.has(extension) || texture.extensions?.[extension] === undefined) continue;
      throw new Error(`glTF ${extension} texture ${textureIndex} in ${src} must omit core source when the extension is required`);
    }
  }
};

const assertGsTextureSvgReferences = (src: string, document: GltfDocument): void => {
  const textures = document.textures ?? [];
  if (!textures.some((texture) => texture.extensions?.GS_texture_svg !== undefined)) return;
  if (!hasExtension(document.extensionsUsed, "GS_texture_svg")) {
    throw new Error(`glTF GS_texture_svg is used by ${src} but is missing from extensionsUsed`);
  }
  if (hasExtension(document.extensionsRequired, "GS_texture_svg")) {
    throw new Error(`glTF GS_texture_svg in ${src} must not be listed in extensionsRequired; provide one core source fallback instead`);
  }

  for (const [textureIndex, texture] of textures.entries()) {
    const extension = texture.extensions?.GS_texture_svg;
    if (extension === undefined) continue;
    if (texture.extensions?.EXT_texture_webp !== undefined || texture.extensions?.KHR_texture_basisu !== undefined) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} must not include additional texture source fallbacks`);
    }
    if (texture.source === undefined || !Number.isInteger(texture.source) || texture.source < 0) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} must provide exactly one core source fallback`);
    }
    if (extension.source === undefined || !Number.isInteger(extension.source) || extension.source < 0) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} has an invalid source`);
    }

    const fallbackImage = document.images?.[texture.source];
    if (fallbackImage === undefined) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} references missing fallback image ${texture.source}`);
    }
    if (texture.source === extension.source || imageLooksSvg(fallbackImage)) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} core source fallback must be a non-SVG image`);
    }

    const image = document.images?.[extension.source];
    if (image === undefined) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} references missing image ${extension.source}`);
    }
    if (image.bufferView !== undefined && !isSvgMimeType(image.mimeType)) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} bufferView image must use image/svg+xml`);
    }
    if (image.uri !== undefined && isDataUri(image.uri) && !isSvgMimeType(dataUriMediaType(image.uri))) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} data URI image must use image/svg+xml`);
    }
    if (image.uri !== undefined && !isDataUri(image.uri) && image.mimeType !== undefined && !isSvgMimeType(image.mimeType)) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} image must be SVG data`);
    }
    if (image.uri !== undefined && !isDataUri(image.uri) && image.mimeType === undefined && !isSvgUri(image.uri)) {
      throw new Error(`glTF GS_texture_svg texture ${textureIndex} in ${src} image URI should end in .svg or declare image/svg+xml`);
    }
  }
};
