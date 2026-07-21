import type { TextureSampler } from "@royal/renderer-core";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type {
  EmbeddedTextureAssetRef,
  TextureLeafSourceRef,
  TextureSourceEncoding,
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
import {
  IDENTITY_TEXTURE_COORDINATES,
  prepareTextureCoordinates,
  type CanonicalTextureCoordinates,
} from "./texture-coordinates";

type MaterialTextureUse = Readonly<{
  asset: TextureSourceRef;
  coordinates: CanonicalTextureCoordinates;
}>;

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

const GLTF_MIN_FILTERS = {
  9728: "nearest",
  9729: "linear",
  9984: "nearest-mipmap-nearest",
  9985: "linear-mipmap-nearest",
  9986: "nearest-mipmap-linear",
  9987: "linear-mipmap-linear",
} as const satisfies Readonly<Record<number, NonNullable<TextureSampler["minFilter"]>>>;

const gltfMinFilter = (
  value: unknown,
  label: string,
  path: string,
): NonNullable<TextureSampler["minFilter"]> => {
  if (value === undefined) return "linear-mipmap-linear";
  const filter = GLTF_MIN_FILTERS[integer(value, label, path) as keyof typeof GLTF_MIN_FILTERS];
  return filter ?? fail(label, path, "is not a core glTF filter");
};

const gltfSampler = (value: JsonObject, label: string, path: string): TextureSampler => {
  const magFilter = value.magFilter === undefined
    ? "linear"
    : value.magFilter === 9728 ? "nearest"
      : value.magFilter === 9729 ? "linear"
        : fail(label, `${path}.magFilter`, "must be NEAREST or LINEAR");
  const minFilter = gltfMinFilter(value.minFilter, label, `${path}.minFilter`);
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
  etc2Available = true,
): ((
  value: unknown,
  path: string,
  colorSpace?: "linear" | "srgb",
) => TextureSourceRef) => {
  const images = optionalArray(document.images, label, "images");
  const samplers = optionalArray(document.samplers, label, "samplers");
  const textures = optionalArray(document.textures, label, "textures");
  const etc2Required = optionalArray(document.extensionsRequired, label, "extensionsRequired")
    .some((extension) => extension === "GS_texture_etc2");
  const svgRequired = optionalArray(document.extensionsRequired, label, "extensionsRequired")
    .some((extension) => extension === "GS_texture_svg");
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
    const etc2Extension = textureExtensions.GS_texture_etc2 === undefined
      ? undefined
      : object(
        textureExtensions.GS_texture_etc2,
        label,
        `${texturePath}.extensions.GS_texture_etc2`,
      );
    const svgExtension = textureExtensions.GS_texture_svg === undefined
      ? undefined
      : object(
        textureExtensions.GS_texture_svg,
        label,
        `${texturePath}.extensions.GS_texture_svg`,
      );
    const webpExtension = textureExtensions.EXT_texture_webp === undefined
      ? undefined
      : object(
        textureExtensions.EXT_texture_webp,
        label,
        `${texturePath}.extensions.EXT_texture_webp`,
      );
    const fallbackExtension = etc2Extension !== undefined && etc2Available
      ? "GS_texture_etc2"
      : webpExtension === undefined ? undefined : "EXT_texture_webp";
    if (etc2Extension !== undefined && texture.source === undefined && !etc2Required) {
      fail(
        label,
        `${texturePath}.source`,
        "is required when optional GS_texture_etc2 needs a core fallback",
      );
    }
    if (svgExtension !== undefined && colorSpace !== "srgb") {
      fail(
        label,
        `${texturePath}.extensions.GS_texture_svg`,
        "is supported only for sRGB color texture slots",
      );
    }
    if (svgExtension !== undefined && texture.source === undefined && !svgRequired) {
      fail(
        label,
        `${texturePath}.source`,
        "is required when optional GS_texture_svg needs a core raster fallback",
      );
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
    const readImage = (
      sourceValue: unknown,
      sourcePath: string,
      sourceEncoding?: TextureSourceEncoding,
    ): TextureLeafSourceRef => {
      const imageIndex = index(sourceValue, images, label, sourcePath);
      const imagePath = `images[${imageIndex}]`;
      const image = object(images[imageIndex], label, imagePath);
      if ((image.uri === undefined) === (image.bufferView === undefined)) {
        fail(label, imagePath, "must contain exactly one of uri or bufferView");
      }
      const expectedMime = sourceEncoding === "ktx2-etc2"
        ? "image/ktx2"
        : sourceEncoding === "svg" ? "image/svg+xml" : undefined;
      const mimeError = sourceEncoding === "ktx2-etc2"
        ? "must be image/ktx2 for GS_texture_etc2"
        : "must be image/svg+xml for GS_texture_svg";
      if (image.bufferView === undefined) {
        const uri = image.uri;
        if (typeof uri !== "string" || uri.length === 0) {
          fail(label, `${imagePath}.uri`, "must be a non-empty URI");
        }
        if (expectedMime !== undefined && image.mimeType !== undefined && image.mimeType !== expectedMime) {
          fail(label, `${imagePath}.mimeType`, mimeError);
        }
        const resolvedUri = resolveAssetUri(sourceUri, uri as string);
        return {
          colorSpace,
          contentKey: `${contentKey}:external:${resolvedUri}`,
          kind: "asset",
          sampler,
          ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
          src: resolvedUri,
        };
      }
      if (expectedMime === undefined ? (
        image.mimeType !== "image/avif"
        && image.mimeType !== "image/jpeg"
        && image.mimeType !== "image/png"
        && image.mimeType !== "image/webp"
      ) : image.mimeType !== expectedMime) {
        fail(
          label,
          `${imagePath}.mimeType`,
          expectedMime === undefined
            ? "must be image/avif, image/jpeg, image/png, or image/webp"
            : mimeError,
        );
      }
      const mimeType = image.mimeType as EmbeddedTextureAssetRef["mimeType"];
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
      return {
        bytes: new Uint8Array(binary.buffer, binary.byteOffset + byteOffset, byteLength),
        colorSpace,
        contentKey: `${contentKey}:bufferView:${viewIndex}`,
        kind: "embedded-asset",
        label: `${label} ${imagePath}`,
        mimeType,
        sampler,
        ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
      };
    };
    const fallbackSource = (): TextureLeafSourceRef => fallbackExtension === "GS_texture_etc2"
      ? readImage(
        etc2Extension!.source,
        `${texturePath}.extensions.GS_texture_etc2.source`,
        "ktx2-etc2",
      )
      : fallbackExtension === "EXT_texture_webp"
        ? readImage(webpExtension!.source, `${texturePath}.extensions.EXT_texture_webp.source`)
        : readImage(texture.source, `${texturePath}.source`);
    let asset: TextureSourceRef;
    if (svgExtension === undefined) asset = fallbackSource();
    else {
      const preferred = readImage(
        svgExtension.source,
        `${texturePath}.extensions.GS_texture_svg.source`,
        "svg",
      );
      asset = svgRequired ? preferred : { ...preferred, fallback: fallbackSource() };
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
  const iorExtension = extensions.KHR_materials_ior === undefined
    ? undefined
    : object(
      extensions.KHR_materials_ior,
      label,
      `${materialPath}.extensions.KHR_materials_ior`,
    );
  if (unlit && iorExtension !== undefined) {
    fail(label, `${materialPath}.extensions`, "must not combine KHR_materials_ior with KHR_materials_unlit");
  }
  const specularExtension = extensions.KHR_materials_specular === undefined
    ? undefined
    : object(
      extensions.KHR_materials_specular,
      label,
      `${materialPath}.extensions.KHR_materials_specular`,
    );
  if (unlit && specularExtension !== undefined) {
    fail(label, `${materialPath}.extensions`, "must not combine KHR_materials_specular with KHR_materials_unlit");
  }
  const transmissionExtension = extensions.KHR_materials_transmission === undefined
    ? undefined
    : object(
      extensions.KHR_materials_transmission,
      label,
      `${materialPath}.extensions.KHR_materials_transmission`,
    );
  const volumeExtension = extensions.KHR_materials_volume === undefined
    ? undefined
    : object(
      extensions.KHR_materials_volume,
      label,
      `${materialPath}.extensions.KHR_materials_volume`,
    );
  if (volumeExtension !== undefined && transmissionExtension === undefined) {
    fail(
      label,
      `${materialPath}.extensions.KHR_materials_volume`,
      "requires KHR_materials_transmission in Royal's static profile",
    );
  }
  if (unlit && (transmissionExtension !== undefined || volumeExtension !== undefined)) {
    fail(label, `${materialPath}.extensions`, "must not combine transmission or volume with KHR_materials_unlit");
  }
  const indexOfRefraction = finiteFactor(
    iorExtension?.ior,
    1.5,
    label,
    `${materialPath}.extensions.KHR_materials_ior.ior`,
  );
  if (indexOfRefraction !== 0 && indexOfRefraction < 1) {
    fail(
      label,
      `${materialPath}.extensions.KHR_materials_ior.ior`,
      "must be zero or at least one",
    );
  }
  if (
    material.alphaMode !== undefined
    && material.alphaMode !== "OPAQUE"
    && material.alphaMode !== "MASK"
    && material.alphaMode !== "BLEND"
  ) {
    fail(label, `${materialPath}.alphaMode`, "must be OPAQUE, MASK, or BLEND");
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
  ): MaterialTextureUse | undefined => {
    if (value === undefined) return undefined;
    const textureInfo = object(value, label, textureInfoPath);
    return {
      asset: textureAsset(textureInfo.index, `${textureInfoPath}.index`, colorSpace),
      coordinates: prepareTextureCoordinates(textureInfo, label, textureInfoPath),
    };
  };
  const baseColorTexture = materialTexture(
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
    ...(material.alphaMode === "BLEND" ? { alphaBlend: true as const } : {}),
    ...(alphaCutoff === undefined ? {} : { alphaCutoff }),
    ...(material.doubleSided === true ? { doubleSided: true as const } : {}),
  };
  if (unlit) return {
    ...presentation,
    baseColor,
    ...(baseColorTexture === undefined ? {} : { baseColorAsset: baseColorTexture.asset }),
    ...(baseColorTexture === undefined || baseColorTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { baseColorTextureCoordinates: baseColorTexture.coordinates }),
    kind: "unlit",
    requiresTextureCoordinates: baseColorTexture !== undefined,
  };
  const metallicRoughnessTexture = materialTexture(
    pbr.metallicRoughnessTexture,
    `${materialPath}.pbrMetallicRoughness.metallicRoughnessTexture`,
    "linear",
  );
  const normalTextureUse = materialTexture(
    material.normalTexture,
    `${materialPath}.normalTexture`,
    "linear",
  );
  const occlusionTextureUse = materialTexture(
    material.occlusionTexture,
    `${materialPath}.occlusionTexture`,
    "linear",
  );
  const emissiveTexture = materialTexture(
    material.emissiveTexture,
    `${materialPath}.emissiveTexture`,
    "srgb",
  );
  const specularTexture = materialTexture(
    specularExtension?.specularTexture,
    `${materialPath}.extensions.KHR_materials_specular.specularTexture`,
    "linear",
  );
  const specularColorTexture = materialTexture(
    specularExtension?.specularColorTexture,
    `${materialPath}.extensions.KHR_materials_specular.specularColorTexture`,
    "srgb",
  );
  const transmissionTexture = materialTexture(
    transmissionExtension?.transmissionTexture,
    `${materialPath}.extensions.KHR_materials_transmission.transmissionTexture`,
    "linear",
  );
  const thicknessTexture = materialTexture(
    volumeExtension?.thicknessTexture,
    `${materialPath}.extensions.KHR_materials_volume.thicknessTexture`,
    "linear",
  );
  const specularColor = finiteTuple(
    specularExtension?.specularColorFactor,
    3,
    [1, 1, 1],
    label,
    `${materialPath}.extensions.KHR_materials_specular.specularColorFactor`,
  );
  for (let channel = 0; channel < 3; channel += 1) {
    if (specularColor[channel]! < 0) {
      fail(
        label,
        `${materialPath}.extensions.KHR_materials_specular.specularColorFactor[${channel}]`,
        "must not be negative",
      );
    }
  }
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
  const attenuationColor = finiteTuple(
    volumeExtension?.attenuationColor,
    3,
    [1, 1, 1],
    label,
    `${materialPath}.extensions.KHR_materials_volume.attenuationColor`,
  );
  for (let channel = 0; channel < 3; channel += 1) {
    if (attenuationColor[channel]! < 0 || attenuationColor[channel]! > 1) {
      fail(
        label,
        `${materialPath}.extensions.KHR_materials_volume.attenuationColor[${channel}]`,
        "must be within 0..1",
      );
    }
  }
  const attenuationDistance = volumeExtension?.attenuationDistance === undefined
    ? undefined
    : finiteFactor(
      volumeExtension.attenuationDistance,
      1,
      label,
      `${materialPath}.extensions.KHR_materials_volume.attenuationDistance`,
    );
  if (attenuationDistance !== undefined && attenuationDistance <= 0) {
    fail(
      label,
      `${materialPath}.extensions.KHR_materials_volume.attenuationDistance`,
      "must be greater than zero",
    );
  }
  const thicknessFactor = finiteFactor(
    volumeExtension?.thicknessFactor,
    0,
    label,
    `${materialPath}.extensions.KHR_materials_volume.thicknessFactor`,
  );
  if (thicknessFactor < 0) {
    fail(
      label,
      `${materialPath}.extensions.KHR_materials_volume.thicknessFactor`,
      "must not be negative",
    );
  }
  const transmissionFactor = factor01(
    transmissionExtension?.transmissionFactor,
    0,
    label,
    `${materialPath}.extensions.KHR_materials_transmission.transmissionFactor`,
  );
  const transmissionActive = transmissionFactor > 0;
  const volumeActive = transmissionActive && thicknessFactor > 0;
  return {
    ...presentation,
    baseColor,
    ...(baseColorTexture === undefined ? {} : { baseColorAsset: baseColorTexture.asset }),
    ...(baseColorTexture === undefined || baseColorTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { baseColorTextureCoordinates: baseColorTexture.coordinates }),
    emissiveFactor: [
      emissive[0]! * emissiveStrength,
      emissive[1]! * emissiveStrength,
      emissive[2]! * emissiveStrength,
    ],
    ...(emissiveTexture === undefined ? {} : { emissiveAsset: emissiveTexture.asset }),
    ...(emissiveTexture === undefined || emissiveTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { emissiveTextureCoordinates: emissiveTexture.coordinates }),
    kind: "standard",
    ...(iorExtension === undefined ? {} : { indexOfRefraction }),
    metallicFactor: factor01(pbr.metallicFactor, 1, label, `${materialPath}.pbrMetallicRoughness.metallicFactor`),
    ...(metallicRoughnessTexture === undefined ? {} : { metallicRoughnessAsset: metallicRoughnessTexture.asset }),
    ...(metallicRoughnessTexture === undefined
      || metallicRoughnessTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { metallicRoughnessTextureCoordinates: metallicRoughnessTexture.coordinates }),
    ...(normalTextureUse === undefined ? {} : { normalAsset: normalTextureUse.asset }),
    normalScale: normalTexture === undefined
      ? 1
      : finiteFactor(normalTexture.scale, 1, label, `${materialPath}.normalTexture.scale`),
    ...(normalTextureUse === undefined || normalTextureUse.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { normalTextureCoordinates: normalTextureUse.coordinates }),
    ...(occlusionTextureUse === undefined ? {} : { occlusionAsset: occlusionTextureUse.asset }),
    occlusionStrength: occlusionTexture === undefined
      ? 1
      : factor01(occlusionTexture.strength, 1, label, `${materialPath}.occlusionTexture.strength`),
    ...(occlusionTextureUse === undefined
      || occlusionTextureUse.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { occlusionTextureCoordinates: occlusionTextureUse.coordinates }),
    requiresTextureCoordinates: baseColorTexture !== undefined
      || metallicRoughnessTexture !== undefined
      || normalTextureUse !== undefined
      || occlusionTextureUse !== undefined
      || emissiveTexture !== undefined
      || specularTexture !== undefined
      || specularColorTexture !== undefined
      || (volumeActive && thicknessTexture !== undefined)
      || (transmissionActive && transmissionTexture !== undefined),
    roughnessFactor: factor01(pbr.roughnessFactor, 1, label, `${materialPath}.pbrMetallicRoughness.roughnessFactor`),
    ...(specularExtension === undefined ? {} : {
      specularColorFactor: [specularColor[0]!, specularColor[1]!, specularColor[2]!] as const,
      specularFactor: factor01(
        specularExtension.specularFactor,
        1,
        label,
        `${materialPath}.extensions.KHR_materials_specular.specularFactor`,
      ),
    }),
    ...(specularTexture === undefined ? {} : { specularTextureAsset: specularTexture.asset }),
    ...(specularTexture === undefined || specularTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { specularTextureCoordinates: specularTexture.coordinates }),
    ...(specularColorTexture === undefined ? {} : { specularColorAsset: specularColorTexture.asset }),
    ...(specularColorTexture === undefined || specularColorTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { specularColorTextureCoordinates: specularColorTexture.coordinates }),
    ...(transmissionExtension === undefined ? {} : {
      transmissionFactor,
    }),
    ...(!transmissionActive || transmissionTexture === undefined
      ? {} : { transmissionAsset: transmissionTexture.asset }),
    ...(!transmissionActive
      || transmissionTexture === undefined
      || transmissionTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { transmissionTextureCoordinates: transmissionTexture.coordinates }),
    ...(volumeExtension === undefined ? {} : {
      attenuationColor: [
        attenuationColor[0]!,
        attenuationColor[1]!,
        attenuationColor[2]!,
      ] as const,
      ...(attenuationDistance === undefined ? {} : { attenuationDistance }),
      thicknessFactor,
    }),
    ...(!volumeActive || thicknessTexture === undefined ? {} : { thicknessAsset: thicknessTexture.asset }),
    ...(!volumeActive
      || thicknessTexture === undefined
      || thicknessTexture.coordinates === IDENTITY_TEXTURE_COORDINATES
      ? {}
      : { thicknessTextureCoordinates: thicknessTexture.coordinates }),
  };
};
