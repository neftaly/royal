import { fail, object, optionalArray, type JsonObject } from "./gltf-values";
import { validateRequiredExtensionProfile } from "./required-extension-profile";

export type StaticGltfDeclarations = Readonly<{
  usesDraco: boolean;
  usesMeshQuantization: boolean;
}>;

/** Shared pure declaration preflight; no reads or codec work may precede it. */
export const validateStaticGltfDeclarations = (
  document: JsonObject,
  label: string,
  dracoAvailable: boolean,
  meshoptAvailable: boolean,
  etc2Available: boolean,
): StaticGltfDeclarations => {
  const asset = object(document.asset, label, "asset");
  if (asset.version !== "2.0") fail(label, "asset.version", "must be 2.0");
  // Static ingestion intentionally ignores animation declarations. The bind
  // pose remains renderable without making animation part of this cold ABI.
  optionalArray(document.animations, label, "animations");
  if (optionalArray(document.skins, label, "skins").length > 0) {
    fail(label, "skins", "are not supported yet");
  }
  const requiredExtensions = optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  );
  const usedExtensions = optionalArray(document.extensionsUsed, label, "extensionsUsed");
  validateRequiredExtensionProfile(
    document,
    requiredExtensions,
    usedExtensions,
    label,
    dracoAvailable,
    meshoptAvailable,
    etc2Available,
  );
  return {
    usesDraco: usedExtensions.includes("KHR_draco_mesh_compression")
      || requiredExtensions.includes("KHR_draco_mesh_compression"),
    usesMeshQuantization: requiredExtensions.includes("KHR_mesh_quantization"),
  };
};
