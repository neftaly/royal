export type GltfBasisuTranscodeTarget = "astc-4x4" | "bc7" | "bc3" | "etc2" | "rgba32";

type CompressedTarget = Exclude<GltfBasisuTranscodeTarget, "rgba32">;

const REQUIRED_EXTENSIONS: readonly Readonly<{
  extensions: readonly string[];
  target: CompressedTarget;
}>[] = [
  { extensions: ["WEBGL_compressed_texture_astc"], target: "astc-4x4" },
  { extensions: ["EXT_texture_compression_bptc"], target: "bc7" },
  {
    extensions: ["WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb"],
    target: "bc3",
  },
  { extensions: ["WEBGL_compressed_texture_etc"], target: "etc2" },
];

/** Pure preference policy: keep Basis payloads compressed in the best available RGBA format. */
export const selectGltfBasisuTranscodeTarget = (
  supportedExtensions: ReadonlySet<string>,
): GltfBasisuTranscodeTarget => {
  for (const candidate of REQUIRED_EXTENSIONS) {
    if (candidate.extensions.every((extension) => supportedExtensions.has(extension))) {
      return candidate.target;
    }
  }
  return "rgba32";
};

/** WebGL's BC extensions require the top-level dimensions to be block aligned. */
export const gltfBasisuTargetAcceptsBaseDimensions = (
  target: GltfBasisuTranscodeTarget,
  width: number,
  height: number,
): boolean => (target !== "bc7" && target !== "bc3") || (width % 4 === 0 && height % 4 === 0);

/** WebGL shell: enables the extensions whose enums will be used by later uploads. */
export const activateGltfBasisuTranscodeTarget = (
  gl: WebGL2RenderingContext,
): GltfBasisuTranscodeTarget => {
  if (typeof gl.getSupportedExtensions !== "function" || typeof gl.getExtension !== "function") return "rgba32";
  const advertised = new Set(gl.getSupportedExtensions() ?? []);
  for (const candidate of REQUIRED_EXTENSIONS) {
    if (!candidate.extensions.every((extension) => advertised.has(extension))) continue;
    if (candidate.extensions.every((extension) => gl.getExtension(extension) !== null)) {
      return candidate.target;
    }
  }
  return "rgba32";
};
