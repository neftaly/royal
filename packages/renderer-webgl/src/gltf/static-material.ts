import type { TextureSampler } from "@royal/renderer-core";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type {
  EmbeddedTextureAssetRef,
  TextureSourceRef,
} from "../texture/asset-owner";
import {
  fail,
  finiteTuple,
  index,
  integer,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

const factor01 = (
  value: unknown,
  fallback: number,
  label: string,
  path: string,
): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(label, path, "must be finite");
  }
  if (value < 0 || value > 1) fail(label, path, "must be within 0..1");
  return value;
};

const finiteFactor = (
  value: unknown,
  fallback: number,
  label: string,
  path: string,
): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(label, path, "must be finite");
  }
  return value;
};

export const resolveAssetUri = (baseUri: string, uri: string): string => {
  try {
    return new URL(uri, baseUri).href;
  } catch {
    const base = baseUri.split("#", 1)[0]!.split("?", 1)[0]!;
    const directory = base.slice(0, base.lastIndexOf("/") + 1);
    const resolved = new URL(uri, `https://royal.invalid/${directory.replace(/^\/+/, "")}`);
    return resolved.origin === "https://royal.invalid"
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : resolved.href;
  }
};

const gltfSampler = (value: JsonObject, label: string, path: string): TextureSampler => {
  const magFilter = value.magFilter === undefined
    ? "linear"
    : value.magFilter === 9728 ? "nearest"
      : value.magFilter === 9729 ? "linear"
        : fail(label, `${path}.magFilter`, "must be NEAREST or LINEAR");
  const minFilters = new Map<number, NonNullable<TextureSampler["minFilter"]>>([
    [9728, "nearest"],
    [9729, "linear"],
    [9984, "nearest-mipmap-nearest"],
    [9985, "linear-mipmap-nearest"],
    [9986, "nearest-mipmap-linear"],
    [9987, "linear-mipmap-linear"],
  ]);
  const minFilter = value.minFilter === undefined
    ? "linear-mipmap-linear"
    : minFilters.get(integer(value.minFilter, label, `${path}.minFilter`))
      ?? fail(label, `${path}.minFilter`, "is not a core glTF filter");
  const readWrap = (input: unknown, field: string): NonNullable<TextureSampler["wrapS"]> => {
    if (input === undefined || input === 10497) return "repeat";
    if (input === 33071) return "clamp-to-edge";
    if (input === 33648) return "mirrored-repeat";
    return fail(label, `${path}.${field}`, "is not a core glTF wrap mode");
  };
  return {
    magFilter,
    minFilter,
    wrapS: readWrap(value.wrapS, "wrapS"),
    wrapT: readWrap(value.wrapT, "wrapT"),
  };
};

export const createTextureAssetReader = (
  document: JsonObject,
  binary: Uint8Array,
  bufferByteLength: number,
  bufferViews: readonly unknown[],
  contentKey: string,
  sourceUri: string,
  label: string,
): ((
  value: unknown,
  path: string,
  colorSpace?: "linear" | "srgb",
) => TextureSourceRef) => {
  const images = optionalArray(document.images, label, "images");
  const samplers = optionalArray(document.samplers, label, "samplers");
  const textures = optionalArray(document.textures, label, "textures");
  const prepared = new Map<string, TextureSourceRef>();
  return (value, path, colorSpace = "srgb") => {
    const textureIndex = index(value, textures, label, path);
    const preparedKey = `${textureIndex}:${colorSpace}`;
    const retained = prepared.get(preparedKey);
    if (retained !== undefined) return retained;
    const textureValue = textures[textureIndex];
    const texturePath = `textures[${textureIndex}]`;
    const texture = object(textureValue, label, texturePath);
    const textureExtensions = texture.extensions === undefined
      ? {}
      : object(texture.extensions, label, `${texturePath}.extensions`);
    const avifExtension = textureExtensions.EXT_texture_avif === undefined
      ? undefined
      : object(
        textureExtensions.EXT_texture_avif,
        label,
        `${texturePath}.extensions.EXT_texture_avif`,
      );
    const sourceValue = avifExtension?.source ?? texture.source;
    const sourcePath = avifExtension === undefined
      ? `${texturePath}.source`
      : `${texturePath}.extensions.EXT_texture_avif.source`;
    const imageIndex = index(sourceValue, images, label, sourcePath);
    const imagePath = `images[${imageIndex}]`;
    const image = object(images[imageIndex], label, imagePath);
    if ((image.uri === undefined) === (image.bufferView === undefined)) {
      fail(label, imagePath, "must contain exactly one of uri or bufferView");
    }
    let sampler: TextureSampler;
    if (texture.sampler === undefined) {
      sampler = gltfSampler({}, label, `${texturePath}.sampler`);
    } else {
      const samplerIndex = index(texture.sampler, samplers, label, `${texturePath}.sampler`);
      const samplerPath = `samplers[${samplerIndex}]`;
      sampler = gltfSampler(
        object(samplers[samplerIndex], label, samplerPath),
        label,
        samplerPath,
      );
    }
    let asset: TextureSourceRef;
    if (image.bufferView === undefined) {
      if (typeof image.uri !== "string" || image.uri.length === 0) {
        fail(label, `${imagePath}.uri`, "must be a non-empty URI");
      }
      const resolvedUri = resolveAssetUri(sourceUri, image.uri as string);
      asset = {
        colorSpace,
        contentKey: `${contentKey}:external:${resolvedUri}`,
        kind: "asset",
        sampler,
        src: resolvedUri,
      };
    } else {
      if (
        image.mimeType !== "image/avif"
        && image.mimeType !== "image/jpeg"
        && image.mimeType !== "image/png"
      ) {
        fail(label, `${imagePath}.mimeType`, "must be image/avif, image/jpeg, or image/png");
      }
      const mimeType = image.mimeType as "image/avif" | "image/jpeg" | "image/png";
      const viewIndex = index(image.bufferView, bufferViews, label, `${imagePath}.bufferView`);
      const viewPath = `bufferViews[${viewIndex}]`;
      const view = object(bufferViews[viewIndex], label, viewPath);
      if (view.buffer !== 0) fail(label, `${viewPath}.buffer`, "must reference GLB buffer 0");
      const byteOffset = view.byteOffset === undefined
        ? 0
        : nonNegativeInteger(view.byteOffset, label, `${viewPath}.byteOffset`);
      const byteLength = nonNegativeInteger(view.byteLength, label, `${viewPath}.byteLength`);
      if (byteLength === 0 || byteOffset + byteLength > bufferByteLength) {
        fail(label, viewPath, "embedded image bytes exceed the declared GLB buffer");
      }
      const bytes = new Uint8Array(
        binary.buffer,
        binary.byteOffset + byteOffset,
        byteLength,
      );
      asset = {
        bytes,
        colorSpace,
        contentKey: `${contentKey}:bufferView:${viewIndex}`,
        kind: "embedded-asset",
        label: `${label} ${imagePath}`,
        mimeType,
        sampler,
      } satisfies EmbeddedTextureAssetRef;
    }
    prepared.set(preparedKey, asset);
    return asset;
  };
};

export const prepareMaterial = (
  materials: unknown[],
  textureAsset: (
    value: unknown,
    path: string,
    colorSpace?: "linear" | "srgb",
  ) => TextureSourceRef,
  materialIndex: unknown,
  label: string,
  path: string,
): CanonicalSurfaceMaterial => {
  if (materialIndex === undefined) {
    return {
      baseColor: [1, 1, 1, 1],
      emissiveFactor: [0, 0, 0],
      kind: "standard",
      metallicFactor: 1,
      normalScale: 1,
      occlusionStrength: 1,
      requiresTextureCoordinates: false,
      roughnessFactor: 1,
    };
  }
  const resolvedIndex = index(materialIndex, materials, label, `${path}.material`);
  const material = object(materials[resolvedIndex], label, `materials[${resolvedIndex}]`);
  const materialPath = `materials[${resolvedIndex}]`;
  const extensions = material.extensions === undefined
    ? {}
    : object(material.extensions, label, `${materialPath}.extensions`);
  const unlit = extensions.KHR_materials_unlit !== undefined;
  if (unlit) object(
    extensions.KHR_materials_unlit,
    label,
    `${materialPath}.extensions.KHR_materials_unlit`,
  );
  if (
    material.alphaMode !== undefined
    && material.alphaMode !== "OPAQUE"
    && material.alphaMode !== "MASK"
  ) {
    fail(label, `${materialPath}.alphaMode`, "must be OPAQUE or MASK");
  }
  if (material.doubleSided !== undefined && typeof material.doubleSided !== "boolean") {
    fail(label, `${materialPath}.doubleSided`, "must be boolean");
  }
  const alphaCutoff = material.alphaMode === "MASK"
    ? factor01(material.alphaCutoff, 0.5, label, `${materialPath}.alphaCutoff`)
    : undefined;
  const pbr = material.pbrMetallicRoughness === undefined
    ? {}
    : object(material.pbrMetallicRoughness, label, `${materialPath}.pbrMetallicRoughness`);
  const materialTexture = (
    value: unknown,
    textureInfoPath: string,
    colorSpace: "linear" | "srgb",
  ): TextureSourceRef | undefined => {
    if (value === undefined) return undefined;
    const textureInfo = object(value, label, textureInfoPath);
    if (textureInfo.texCoord !== undefined && textureInfo.texCoord !== 0) {
      fail(label, `${textureInfoPath}.texCoord`, "must select TEXCOORD_0");
    }
    return textureAsset(
      textureInfo.index,
      `${textureInfoPath}.index`,
      colorSpace,
    );
  };
  const baseColorAsset = materialTexture(
    pbr.baseColorTexture,
    `${materialPath}.pbrMetallicRoughness.baseColorTexture`,
    "srgb",
  );
  const color = finiteTuple(
    pbr.baseColorFactor,
    4,
    [1, 1, 1, 1],
    label,
    `${materialPath}.pbrMetallicRoughness.baseColorFactor`,
  );
  for (let channel = 0; channel < 4; channel += 1) {
    if (color[channel]! < 0 || color[channel]! > 1) {
      fail(label, `${materialPath}.pbrMetallicRoughness.baseColorFactor[${channel}]`, "must be within 0..1");
    }
  }
  const baseColor = [color[0]!, color[1]!, color[2]!, color[3]!] as const;
  const presentation = {
    ...(alphaCutoff === undefined ? {} : { alphaCutoff }),
    ...(material.doubleSided === true ? { doubleSided: true as const } : {}),
  };
  if (unlit) return {
    ...presentation,
    baseColor,
    ...(baseColorAsset === undefined ? {} : { baseColorAsset }),
    kind: "unlit",
    requiresTextureCoordinates: baseColorAsset !== undefined,
  };
  const metallicRoughnessAsset = materialTexture(
    pbr.metallicRoughnessTexture,
    `${materialPath}.pbrMetallicRoughness.metallicRoughnessTexture`,
    "linear",
  );
  const normalAsset = materialTexture(
    material.normalTexture,
    `${materialPath}.normalTexture`,
    "linear",
  );
  const occlusionAsset = materialTexture(
    material.occlusionTexture,
    `${materialPath}.occlusionTexture`,
    "linear",
  );
  const emissiveAsset = materialTexture(
    material.emissiveTexture,
    `${materialPath}.emissiveTexture`,
    "srgb",
  );
  const emissive = finiteTuple(
    material.emissiveFactor,
    3,
    [0, 0, 0],
    label,
    `${materialPath}.emissiveFactor`,
  );
  for (let channel = 0; channel < 3; channel += 1) {
    if (emissive[channel]! < 0 || emissive[channel]! > 1) {
      fail(label, `${materialPath}.emissiveFactor[${channel}]`, "must be within 0..1");
    }
  }
  const emissiveStrengthExtension = extensions.KHR_materials_emissive_strength === undefined
    ? undefined
    : object(
      extensions.KHR_materials_emissive_strength,
      label,
      `${materialPath}.extensions.KHR_materials_emissive_strength`,
    );
  const emissiveStrength = finiteFactor(
    emissiveStrengthExtension?.emissiveStrength,
    1,
    label,
    `${materialPath}.extensions.KHR_materials_emissive_strength.emissiveStrength`,
  );
  if (emissiveStrength < 0) {
    fail(
      label,
      `${materialPath}.extensions.KHR_materials_emissive_strength.emissiveStrength`,
      "must not be negative",
    );
  }
  const normalTexture = material.normalTexture === undefined
    ? undefined
    : object(material.normalTexture, label, `${materialPath}.normalTexture`);
  const occlusionTexture = material.occlusionTexture === undefined
    ? undefined
    : object(material.occlusionTexture, label, `${materialPath}.occlusionTexture`);
  return {
    ...presentation,
    baseColor,
    ...(baseColorAsset === undefined ? {} : { baseColorAsset }),
    emissiveFactor: [
      emissive[0]! * emissiveStrength,
      emissive[1]! * emissiveStrength,
      emissive[2]! * emissiveStrength,
    ],
    ...(emissiveAsset === undefined ? {} : { emissiveAsset }),
    kind: "standard",
    metallicFactor: factor01(pbr.metallicFactor, 1, label, `${materialPath}.pbrMetallicRoughness.metallicFactor`),
    ...(metallicRoughnessAsset === undefined ? {} : { metallicRoughnessAsset }),
    ...(normalAsset === undefined ? {} : { normalAsset }),
    normalScale: normalTexture === undefined
      ? 1
      : finiteFactor(normalTexture.scale, 1, label, `${materialPath}.normalTexture.scale`),
    ...(occlusionAsset === undefined ? {} : { occlusionAsset }),
    occlusionStrength: occlusionTexture === undefined
      ? 1
      : factor01(occlusionTexture.strength, 1, label, `${materialPath}.occlusionTexture.strength`),
    requiresTextureCoordinates: baseColorAsset !== undefined
      || metallicRoughnessAsset !== undefined
      || normalAsset !== undefined
      || occlusionAsset !== undefined
      || emissiveAsset !== undefined,
    roughnessFactor: factor01(pbr.roughnessFactor, 1, label, `${materialPath}.pbrMetallicRoughness.roughnessFactor`),
  };
};
