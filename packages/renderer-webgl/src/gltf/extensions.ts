import type { GltfDocument } from "./schema";

export const supportedGltfExtensions = new Set<string>([
  "EXT_meshopt_compression",
  "EXT_mesh_gpu_instancing",
  "EXT_texture_webp",
  "KHR_draco_mesh_compression",
  "KHR_texture_basisu",
  "KHR_lights_punctual",
  "KHR_materials_clearcoat",
  "KHR_materials_dispersion",
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
  "KHR_node_visibility",
  "KHR_texture_transform",
  "MSFT_lod",
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
};
