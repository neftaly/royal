import { fail, type JsonObject } from "./gltf-values";

type PlacementProfile = (parentPath: string) => boolean;

const item = (name: string): string => `${name}\\[\\d+\\]`;
const material = new RegExp(`^${item("materials")}$`);
const node = new RegExp(`^${item("nodes")}$`);
const primitive = new RegExp(`^${item("meshes")}\\.primitives\\[\\d+\\]$`);
const texture = new RegExp(`^${item("textures")}$`);
const textureInfo = new RegExp(
  `^${item("materials")}\\.(?:`
  + "pbrMetallicRoughness\\.(?:baseColorTexture|metallicRoughnessTexture)"
  + "|(?:normalTexture|occlusionTexture|emissiveTexture)"
  + "|extensions\\.KHR_materials_specular\\.(?:specularTexture|specularColorTexture)"
  + "|extensions\\.KHR_materials_transmission\\.transmissionTexture"
  + "|extensions\\.KHR_materials_volume\\.thicknessTexture"
  + ")$",
);

const materialOnly: PlacementProfile = (path) => material.test(path);

/** Required names and every object placement implemented by the replacement profile. */
const REQUIRED_EXTENSION_PLACEMENTS: Readonly<Record<string, PlacementProfile>> = {
  EXT_mesh_gpu_instancing: (path) => node.test(path),
  EXT_texture_webp: (path) => texture.test(path),
  GS_texture_etc2: (path) => texture.test(path),
  GS_texture_svg: (path) => texture.test(path),
  KHR_draco_mesh_compression: (path) => primitive.test(path),
  KHR_lights_punctual: (path) => path === "" || node.test(path),
  KHR_materials_emissive_strength: materialOnly,
  KHR_materials_ior: materialOnly,
  KHR_materials_specular: materialOnly,
  KHR_materials_transmission: materialOnly,
  KHR_materials_unlit: materialOnly,
  KHR_materials_variants: (path) => path === "" || primitive.test(path),
  KHR_materials_volume: materialOnly,
  KHR_mesh_quantization: () => false,
  KHR_texture_transform: (path) => textureInfo.test(path),
  MSFT_lod: (path) => material.test(path) || node.test(path),
};

const extensionsPath = (parentPath: string): string =>
  `${parentPath.length === 0 ? "" : `${parentPath}.`}extensions`;

const extensionPath = (parentPath: string, extension: string): string =>
  `${extensionsPath(parentPath)}.${extension}`;

/** Validates declaration support and all observed placements before semantic readers run. */
export const validateRequiredExtensionProfile = (
  document: JsonObject,
  requiredExtensions: readonly unknown[],
  usedExtensions: readonly unknown[],
  label: string,
  dracoAvailable: boolean,
  etc2Available = true,
): void => {
  const used = new Set<string>();
  for (let index = 0; index < usedExtensions.length; index += 1) {
    const extension = usedExtensions[index];
    const extensionName = typeof extension === "string" && extension.length > 0
      ? extension
      : fail(label, `extensionsUsed[${index}]`, "must be a non-empty string");
    if (used.has(extensionName)) {
      fail(label, `extensionsUsed[${index}]`, "must not be duplicated");
    }
    used.add(extensionName);
  }
  const required = new Set<string>();
  for (let index = 0; index < requiredExtensions.length; index += 1) {
    const extension = requiredExtensions[index];
    const extensionName = typeof extension === "string"
      ? extension
      : fail(label, `extensionsRequired[${index}]`, "is unsupported");
    const profile = REQUIRED_EXTENSION_PLACEMENTS[extensionName];
    if (
      profile === undefined
      || (extensionName === "KHR_draco_mesh_compression" && !dracoAvailable)
      || (extensionName === "GS_texture_etc2" && !etc2Available)
    ) {
      fail(
        label,
        `extensionsRequired[${index}]`,
        `is unsupported (${JSON.stringify(extensionName)})`,
      );
    }
    if (required.has(extensionName)) {
      fail(label, `extensionsRequired[${index}]`, "must not be duplicated");
    }
    required.add(extensionName);
  }
  for (const extension of required) {
    if (!used.has(extension)) {
      fail(
        label,
        "extensionsRequired",
        `${JSON.stringify(extension)} must also appear in extensionsUsed`,
      );
    }
  }

  const seen = new WeakSet<object>();
  const visit = (value: unknown, path: string): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        visit(value[index], `${path}[${index}]`);
      }
      return;
    }
    const objectValue = value as JsonObject;
    const extensions = objectValue.extensions;
    if (extensions !== undefined) {
      const extensionObject: JsonObject = typeof extensions === "object"
        && extensions !== null
        && !Array.isArray(extensions)
        ? extensions as JsonObject
        : fail(label, extensionsPath(path), "must be an object");
      for (const extension of Object.keys(extensionObject)) {
        if (!used.has(extension)) {
          fail(label, extensionPath(path, extension), "must be declared in extensionsUsed");
        }
        const profile = REQUIRED_EXTENSION_PLACEMENTS[extension];
        if (required.has(extension) && !profile!(path)) {
          fail(label, extensionPath(path, extension), "is outside Royal's supported placement profile");
        }
        // Optional unsupported extensions are opaque fallback branches.
        // Supported payloads remain part of the executable declaration graph.
        if (profile !== undefined) {
          visit(extensionObject[extension], extensionPath(path, extension));
        }
      }
    }
    for (const [key, child] of Object.entries(objectValue)) {
      if (key !== "extensions") {
        visit(child, path.length === 0 ? key : `${path}.${key}`);
      }
    }
  };
  visit(document, "");
};
