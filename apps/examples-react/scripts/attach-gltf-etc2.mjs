import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION = "GS_texture_etc2";

const object = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const array = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};

const textureInfoIndex = (value, label, textureCount) => {
  if (value === undefined) return undefined;
  const index = object(value, label).index;
  if (!Number.isSafeInteger(index) || index < 0 || index >= textureCount) {
    throw new Error(`${label}.index must reference a texture`);
  }
  return index;
};

const expectedTextureColorSpaces = (document, textureCount) => {
  const uses = Array.from({ length: textureCount }, () => new Set());
  const record = (value, label, colorSpace) => {
    const index = textureInfoIndex(value, label, textureCount);
    if (index !== undefined) uses[index].add(colorSpace);
  };
  const materials = document.materials === undefined
    ? []
    : array(document.materials, "glTF materials");
  for (let index = 0; index < materials.length; index += 1) {
    const path = `materials[${index}]`;
    const material = object(materials[index], path);
    const pbr = material.pbrMetallicRoughness === undefined
      ? undefined
      : object(material.pbrMetallicRoughness, `${path}.pbrMetallicRoughness`);
    record(pbr?.baseColorTexture, `${path}.pbrMetallicRoughness.baseColorTexture`, "srgb");
    record(
      pbr?.metallicRoughnessTexture,
      `${path}.pbrMetallicRoughness.metallicRoughnessTexture`,
      "linear",
    );
    record(material.normalTexture, `${path}.normalTexture`, "linear");
    record(material.occlusionTexture, `${path}.occlusionTexture`, "linear");
    record(material.emissiveTexture, `${path}.emissiveTexture`, "srgb");
    const extensions = material.extensions === undefined
      ? undefined
      : object(material.extensions, `${path}.extensions`);
    const specular = extensions?.KHR_materials_specular === undefined
      ? undefined
      : object(extensions.KHR_materials_specular, `${path}.extensions.KHR_materials_specular`);
    record(specular?.specularTexture, `${path}.extensions.KHR_materials_specular.specularTexture`, "linear");
    record(
      specular?.specularColorTexture,
      `${path}.extensions.KHR_materials_specular.specularColorTexture`,
      "srgb",
    );
    const transmission = extensions?.KHR_materials_transmission === undefined
      ? undefined
      : object(
        extensions.KHR_materials_transmission,
        `${path}.extensions.KHR_materials_transmission`,
      );
    record(
      transmission?.transmissionTexture,
      `${path}.extensions.KHR_materials_transmission.transmissionTexture`,
      "linear",
    );
    const volume = extensions?.KHR_materials_volume === undefined
      ? undefined
      : object(extensions.KHR_materials_volume, `${path}.extensions.KHR_materials_volume`);
    record(volume?.thicknessTexture, `${path}.extensions.KHR_materials_volume.thicknessTexture`, "linear");
  }
  return uses;
};

const checkedInspection = (value, label) => {
  const inspection = object(value, `${label} inspection`);
  if (inspection.colorSpace !== "linear" && inspection.colorSpace !== "srgb") {
    throw new Error(`${label} inspection colorSpace must be linear or srgb`);
  }
  for (const field of ["height", "levelCount", "storageBytes", "width"]) {
    if (!Number.isSafeInteger(inspection[field]) || inspection[field] < 1) {
      throw new Error(`${label} inspection ${field} must be a positive safe integer`);
    }
  }
  return inspection;
};

/** Pure manifest rewrite; byte inspection remains an injected offline boundary. */
export const attachGltfEtc2Sources = (input, attachments) => {
  const document = structuredClone(object(input, "glTF document"));
  const textures = array(document.textures, "glTF textures");
  const images = document.images === undefined ? [] : array(document.images, "glTF images");
  document.images = images;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw new Error("ETC2 attachments must be a non-empty array");
  }
  const required = document.extensionsRequired === undefined
    ? []
    : array(document.extensionsRequired, "glTF extensionsRequired");
  if (required.includes(EXTENSION)) {
    throw new Error("attach-gltf-etc2 authors optional fallback assets, not required-only assets");
  }
  const colorSpaces = expectedTextureColorSpaces(document, textures.length);
  const seen = new Set();
  const summaries = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const label = `attachments[${index}]`;
    const attachment = object(attachments[index], label);
    const textureIndex = attachment.textureIndex;
    if (!Number.isSafeInteger(textureIndex) || textureIndex < 0 || textureIndex >= textures.length) {
      throw new Error(`${label}.textureIndex must reference a texture`);
    }
    if (seen.has(textureIndex)) throw new Error(`${label}.textureIndex is duplicated`);
    seen.add(textureIndex);
    if (typeof attachment.uri !== "string" || attachment.uri.length === 0) {
      throw new Error(`${label}.uri must be a non-empty string`);
    }
    const inspection = checkedInspection(attachment.inspection, label);
    const texture = object(textures[textureIndex], `textures[${textureIndex}]`);
    if (!Number.isSafeInteger(texture.source) || texture.source < 0 || texture.source >= images.length) {
      throw new Error(`textures[${textureIndex}].source must provide a valid core fallback`);
    }
    const extensions = texture.extensions === undefined
      ? {}
      : object(texture.extensions, `textures[${textureIndex}].extensions`);
    if (extensions[EXTENSION] !== undefined) {
      throw new Error(`textures[${textureIndex}] already uses ${EXTENSION}`);
    }
    const uses = colorSpaces[textureIndex];
    if (uses.size === 0) throw new Error(`textures[${textureIndex}] is not used by a supported material slot`);
    if (uses.size !== 1) {
      throw new Error(`textures[${textureIndex}] is shared by linear and sRGB material slots`);
    }
    const expectedColorSpace = uses.values().next().value;
    if (inspection.colorSpace !== expectedColorSpace) {
      throw new Error(
        `textures[${textureIndex}] requires ${expectedColorSpace} storage; KTX2 declares ${inspection.colorSpace}`,
      );
    }
    const imageIndex = images.length;
    images.push({ mimeType: "image/ktx2", uri: attachment.uri });
    extensions[EXTENSION] = { source: imageIndex };
    texture.extensions = extensions;
    summaries.push({
      colorSpace: inspection.colorSpace,
      height: inspection.height,
      imageIndex,
      levelCount: inspection.levelCount,
      storageBytes: inspection.storageBytes,
      textureIndex,
      uri: attachment.uri,
      width: inspection.width,
    });
  }
  const used = document.extensionsUsed === undefined
    ? []
    : array(document.extensionsUsed, "glTF extensionsUsed");
  if (!used.includes(EXTENSION)) document.extensionsUsed = [...used, EXTENSION];
  return { attachments: summaries, document };
};

const parseMapping = (value, index) => {
  const separator = value.indexOf("=");
  if (separator < 1 || separator === value.length - 1) {
    throw new Error(`mapping ${index + 1} must be TEXTURE_INDEX=RELATIVE.ktx2`);
  }
  const textureIndex = Number(value.slice(0, separator));
  const uri = value.slice(separator + 1);
  if (!Number.isSafeInteger(textureIndex) || textureIndex < 0) {
    throw new Error(`mapping ${index + 1} texture index must be a non-negative integer`);
  }
  if (isAbsolute(uri) || /^[a-z][a-z0-9+.-]*:/iu.test(uri) || /[?#]/u.test(uri)) {
    throw new Error(`mapping ${index + 1} URI must be a relative file path without query or fragment`);
  }
  return { textureIndex, uri };
};

const main = async () => {
  const [, , inputPath, outputPath, ...mappingValues] = process.argv;
  if (inputPath === undefined || outputPath === undefined || mappingValues.length === 0) {
    throw new Error(
      "usage: attach-gltf-etc2.mjs INPUT.gltf OUTPUT.gltf TEXTURE_INDEX=RELATIVE.ktx2 [...]",
    );
  }
  const { inspectEtc2Ktx2 } = await import("@royal/renderer-webgl/ktx2");
  const mappings = mappingValues.map(parseMapping);
  const attachments = await Promise.all(mappings.map(async ({ textureIndex, uri }) => ({
    inspection: inspectEtc2Ktx2(new Uint8Array(await readFile(resolve(dirname(outputPath), uri)))),
    textureIndex,
    uri,
  })));
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const result = attachGltfEtc2Sources(input, attachments);
  await writeFile(outputPath, `${JSON.stringify(result.document, null, 2)}\n`);
  const bytes = result.attachments.reduce((total, attachment) => total + attachment.storageBytes, 0);
  console.log(`glTF ETC2: attached ${result.attachments.length} textures (${bytes} GPU bytes)`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
