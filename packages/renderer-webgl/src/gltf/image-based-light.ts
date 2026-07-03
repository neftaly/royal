import type { Vec3 } from "@royal/renderer-core";
import { quaternionMat4, type Mat4 } from "../math/mat4";
import { isPowerOfTwo } from "../texture-sources";
import type {
  SurfaceImageBasedLight,
  SurfaceImageBasedLightSpecular,
  SurfaceIblSpecularEncoding,
} from "../webgl/lights";
import { gltfImageLoadKey } from "./image-keys";
import type {
  GltfDocument,
  GltfImageBasedLight,
} from "./schema";

type GltfImageBasedLightDiagnostics = {
  readonly recordDiagnostic: (message: string) => void;
  readonly recordUnsupportedGltfImageBasedLight: (message: string) => void;
};

const finiteNumber = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const uriMimeType = (uri: string | undefined): string | undefined => {
  if (uri === undefined) return undefined;
  const dataUriMatch = /^data:([^;,]+)/i.exec(uri);
  if (dataUriMatch !== null) return dataUriMatch[1]?.toLowerCase();
  const path = uri.split(/[?#]/, 1)[0]?.toLowerCase();
  if (path === undefined) return undefined;
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";

  return undefined;
};

const gltfImageBasedLightSpecularEncoding = (
  image: NonNullable<GltfDocument["images"]>[number],
): SurfaceIblSpecularEncoding =>
  (image.mimeType ?? uriMimeType(image.uri))?.toLowerCase() === "image/png"
    ? "rgbd"
    : "ldr";

export const gltfImageBasedLightHasValidRotation = (light: GltfImageBasedLight): boolean =>
  light.rotation === undefined
  || (
    Array.isArray(light.rotation)
    && light.rotation.length >= 4
    && light.rotation.slice(0, 4).every((value) => typeof value === "number" && Number.isFinite(value))
  );

export const gltfImageBasedLightRotation = (light: GltfImageBasedLight): Mat4 =>
  quaternionMat4(gltfImageBasedLightHasValidRotation(light) ? light.rotation : undefined);

export const gltfImageBasedLightIntensity = (light: GltfImageBasedLight): number =>
  Math.max(0, finiteNumber(light.intensity, 1));

export const gltfImageBasedLightIrradianceCoefficients = (
  light: GltfImageBasedLight,
): readonly Vec3[] | undefined => {
  const coefficients = light.irradianceCoefficients;
  if (!Array.isArray(coefficients) || coefficients.length !== 9) return undefined;

  const parsed: Vec3[] = [];
  for (const coefficient of coefficients) {
    if (
      !Array.isArray(coefficient)
      || coefficient.length < 3
      || coefficient.slice(0, 3).some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      return undefined;
    }
    parsed.push([
      coefficient[0]!,
      coefficient[1]!,
      coefficient[2]!,
    ]);
  }

  return parsed;
};

const readGltfImageBasedLightSpecular = (
  document: GltfDocument,
  src: string,
  assetKey: string,
  sceneIndex: number,
  lightIndex: number,
  light: GltfImageBasedLight,
  diagnostics: GltfImageBasedLightDiagnostics,
): SurfaceImageBasedLightSpecular | undefined => {
  const specularImages = light.specularImages;
  const imageSize = light.specularImageSize;
  if (specularImages === undefined || typeof imageSize !== "number" || !Number.isFinite(imageSize)) {
    diagnostics.recordUnsupportedGltfImageBasedLight(
      `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} is missing required specularImages/specularImageSize data; specular IBL is disabled for this light.`,
    );
    return undefined;
  }
  if (!isPowerOfTwo(imageSize)) {
    diagnostics.recordUnsupportedGltfImageBasedLight(
      `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} has invalid specularImageSize ${imageSize}; expected a positive power-of-two size.`,
    );
    return undefined;
  }

  const imageLoadKeys: string[][] = [];
  let encoding: SurfaceIblSpecularEncoding = "ldr";
  for (const [mipIndex, mipImages] of specularImages.entries()) {
    if (mipImages.length !== 6) {
      diagnostics.recordUnsupportedGltfImageBasedLight(
        `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} mip ${mipIndex} has ${mipImages.length} specular images; expected 6 cubemap faces.`,
      );
      return undefined;
    }
    const mipKeys: string[] = [];
    for (const [faceIndex, imageIndex] of mipImages.entries()) {
      if (!Number.isInteger(imageIndex) || imageIndex < 0) {
        diagnostics.recordUnsupportedGltfImageBasedLight(
          `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} mip ${mipIndex} face ${faceIndex} has invalid image index ${imageIndex}.`,
        );
        return undefined;
      }
      const image = document.images?.[imageIndex];
      if (image === undefined) {
        diagnostics.recordUnsupportedGltfImageBasedLight(
          `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} mip ${mipIndex} face ${faceIndex} references missing image ${imageIndex}.`,
        );
        return undefined;
      }
      const key = gltfImageLoadKey(assetKey, src, imageIndex, image, "image");
      if (key === undefined) {
        diagnostics.recordUnsupportedGltfImageBasedLight(
          `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} mip ${mipIndex} face ${faceIndex} image ${imageIndex} has no URI or bufferView.`,
        );
        return undefined;
      }
      if (gltfImageBasedLightSpecularEncoding(image) === "rgbd") encoding = "rgbd";
      mipKeys.push(key);
    }
    imageLoadKeys.push(mipKeys);
  }

  if (imageLoadKeys.length === 0) {
    diagnostics.recordUnsupportedGltfImageBasedLight(
      `glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} has no specular mip levels.`,
    );
    return undefined;
  }

  return {
    encoding,
    imageLoadKeys,
    imageSize,
    key: `${assetKey}:ibl-specular:${lightIndex}:${imageSize}:${encoding}:${imageLoadKeys.flat().join("|")}`,
  };
};

export const readGltfSceneImageBasedLight = (
  document: GltfDocument,
  src: string,
  assetKey: string,
  sceneIndex: number,
  diagnostics: GltfImageBasedLightDiagnostics,
): SurfaceImageBasedLight | undefined => {
  const reference = document.scenes?.[sceneIndex]?.extensions?.EXT_lights_image_based;
  if (reference === undefined) return undefined;

  const lightIndex = reference.light;
  if (typeof lightIndex !== "number" || !Number.isInteger(lightIndex) || lightIndex < 0) {
    diagnostics.recordDiagnostic(`glTF scene ${sceneIndex} EXT_lights_image_based skipped: invalid light index ${lightIndex}`);
    return undefined;
  }

  const light = document.extensions?.EXT_lights_image_based?.lights?.[lightIndex];
  if (light === undefined) {
    diagnostics.recordDiagnostic(`glTF scene ${sceneIndex} EXT_lights_image_based skipped: missing light ${lightIndex}`);
    return undefined;
  }

  const coefficients = gltfImageBasedLightIrradianceCoefficients(light);
  if (coefficients === undefined) {
    diagnostics.recordDiagnostic(`glTF scene ${sceneIndex} EXT_lights_image_based skipped: light ${lightIndex} has invalid irradianceCoefficients; expected a 9x3 finite numeric array`);
    return undefined;
  }

  const specular = readGltfImageBasedLightSpecular(document, src, assetKey, sceneIndex, lightIndex, light, diagnostics);
  if (light.rotation !== undefined && !gltfImageBasedLightHasValidRotation(light)) {
    diagnostics.recordDiagnostic(`glTF scene ${sceneIndex} EXT_lights_image_based light ${lightIndex} has invalid rotation; using default [0, 0, 0, 1]`);
  }

  return {
    coefficients,
    intensity: gltfImageBasedLightIntensity(light),
    rotation: gltfImageBasedLightRotation(light),
    ...(specular === undefined ? {} : { specular }),
  };
};
