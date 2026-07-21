import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION = "GS_texture_etc2";
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const USAGE = [
  "usage: pnpm author:gltf-etc2 INPUT.(gltf|glb) OUTPUT.(gltf|glb)",
  "       [--attachments=ATTACHMENTS.json] [TEXTURE_INDEX=RELATIVE.ktx2 ...]",
  "",
  "Attachment files contain an array of { textureIndex, uri } records.",
  "Every KTX2 URI is relative to the output glTF/GLB document.",
].join("\n");

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

const uint32 = (view, offset, label) => {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw new Error(`${label} is truncated`);
  }
  return view.getUint32(offset, true);
};

const gltfDocument = (value, label) => object(value, `${label} JSON`);

/** Parses JSON glTF or GLB while retaining every non-JSON GLB chunk byte-for-byte. */
export const decodeGltfContainer = (input, label = "glTF input") => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 4 || uint32(view, 0, label) !== GLB_MAGIC) {
    return {
      document: gltfDocument(JSON.parse(textDecoder.decode(bytes)), label),
      format: "gltf",
      trailingChunks: [],
    };
  }
  if (bytes.byteLength < 12) throw new Error(`${label} GLB header is truncated`);
  const version = uint32(view, 4, `${label} GLB version`);
  if (version !== GLB_VERSION) {
    throw new Error(`${label} GLB version must be ${GLB_VERSION}, received ${version}`);
  }
  const declaredLength = uint32(view, 8, `${label} GLB length`);
  if (declaredLength !== bytes.byteLength) {
    throw new Error(
      `${label} GLB length ${declaredLength} does not match ${bytes.byteLength} bytes`,
    );
  }
  let offset = 12;
  let document;
  const trailingChunks = [];
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error(`${label} GLB chunk header is truncated`);
    const length = uint32(view, offset, `${label} GLB chunk length`);
    const type = uint32(view, offset + 4, `${label} GLB chunk type`);
    offset += 8;
    if (length % 4 !== 0) throw new Error(`${label} GLB chunk length must be 4-byte aligned`);
    const end = offset + length;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) {
      throw new Error(`${label} GLB chunk exceeds the declared container length`);
    }
    const data = bytes.slice(offset, end);
    offset = end;
    if (document === undefined) {
      if (type !== GLB_JSON_CHUNK) throw new Error(`${label} GLB first chunk must be JSON`);
      document = gltfDocument(JSON.parse(textDecoder.decode(data)), label);
    } else {
      if (type === GLB_JSON_CHUNK) throw new Error(`${label} GLB has more than one JSON chunk`);
      trailingChunks.push({ data, type });
    }
  }
  if (document === undefined) throw new Error(`${label} GLB has no JSON chunk`);
  return { document, format: "glb", trailingChunks };
};

/** Rewrites only semantic JSON; retained GLB payload chunks remain byte-identical. */
export const encodeGltfContainer = (container, document) => {
  const checkedDocument = gltfDocument(document, "glTF output");
  if (container.format === "gltf") {
    return textEncoder.encode(`${JSON.stringify(checkedDocument, null, 2)}\n`);
  }
  if (container.format !== "glb") throw new Error("glTF output container format is invalid");
  const json = textEncoder.encode(JSON.stringify(checkedDocument));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  let totalLength = 12 + 8 + jsonLength;
  for (const [index, chunk] of container.trailingChunks.entries()) {
    if (
      !(chunk.data instanceof Uint8Array)
      || !Number.isSafeInteger(chunk.type)
      || chunk.type < 0
      || chunk.type > 0xffff_ffff
      || chunk.data.byteLength % 4 !== 0
    ) throw new Error(`glTF output trailing chunk ${index} is invalid`);
    totalLength += 8 + chunk.data.byteLength;
  }
  if (!Number.isSafeInteger(totalLength) || totalLength > 0xffff_ffff) {
    throw new Error("glTF output GLB exceeds the 32-bit container length");
  }
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(json, 20);
  let offset = 20 + jsonLength;
  for (const chunk of container.trailingChunks) {
    view.setUint32(offset, chunk.data.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    output.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.byteLength;
  }
  return output;
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
  return checkedAttachmentRecord({
    textureIndex: Number(value.slice(0, separator)),
    uri: value.slice(separator + 1),
  }, `mapping ${index + 1}`);
};

const checkedAttachmentRecord = (value, label) => {
  const record = object(value, label);
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "textureIndex" && key !== "uri")) {
    throw new Error(`${label} supports only textureIndex and uri`);
  }
  if (!Number.isSafeInteger(record.textureIndex) || record.textureIndex < 0) {
    throw new Error(`${label}.textureIndex must be a non-negative integer`);
  }
  if (
    typeof record.uri !== "string"
    || record.uri.length === 0
    || isAbsolute(record.uri)
    || /^[a-z][a-z0-9+.-]*:/iu.test(record.uri)
    || /[?#]/u.test(record.uri)
  ) throw new Error(`${label}.uri must be a relative file path without query or fragment`);
  return { textureIndex: record.textureIndex, uri: record.uri };
};

/** Validates the batch-authoring input before reading any encoded texture bytes. */
export const parseGltfEtc2Attachments = (value) => array(value, "ETC2 attachments")
  .map((entry, index) => checkedAttachmentRecord(entry, `ETC2 attachments[${index}]`));

const outputFormat = (path) => {
  const extension = extname(path).toLowerCase();
  if (extension === ".gltf") return "gltf";
  if (extension === ".glb") return "glb";
  throw new Error("output path must end in .gltf or .glb");
};

const main = async () => {
  const [, , inputPath, outputPath, ...argumentsAfterPaths] = process.argv;
  if (inputPath === undefined || outputPath === undefined) throw new Error(USAGE);
  let attachmentPath;
  const mappingValues = [];
  for (const argument of argumentsAfterPaths) {
    if (argument.startsWith("--attachments=")) {
      if (attachmentPath !== undefined) throw new Error("--attachments may be provided only once");
      attachmentPath = argument.slice("--attachments=".length);
      if (attachmentPath.length === 0) throw new Error("--attachments requires a JSON file path");
    } else if (argument.startsWith("--")) throw new Error(`unknown option ${argument}\n${USAGE}`);
    else mappingValues.push(argument);
  }
  const { inspectEtc2Ktx2 } = await import("@royal/renderer-webgl/ktx2");
  const fileMappings = attachmentPath === undefined
    ? []
    : parseGltfEtc2Attachments(JSON.parse(await readFile(resolve(attachmentPath), "utf8")));
  const mappings = [...fileMappings, ...mappingValues.map(parseMapping)];
  if (mappings.length === 0) throw new Error(USAGE);
  const attachments = await Promise.all(mappings.map(async ({ textureIndex, uri }) => ({
    inspection: inspectEtc2Ktx2(new Uint8Array(await readFile(resolve(dirname(outputPath), uri)))),
    textureIndex,
    uri,
  })));
  const container = decodeGltfContainer(await readFile(inputPath), inputPath);
  const expectedFormat = outputFormat(outputPath);
  if (container.format !== expectedFormat) {
    throw new Error(`input is ${container.format}; output must retain the same container format`);
  }
  const result = attachGltfEtc2Sources(container.document, attachments);
  await writeFile(outputPath, encodeGltfContainer(container, result.document));
  const bytes = result.attachments.reduce((total, attachment) => total + attachment.storageBytes, 0);
  console.log(
    `glTF ETC2: attached ${result.attachments.length} textures`
    + ` (${bytes} GPU bytes) to ${outputPath}`,
  );
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
