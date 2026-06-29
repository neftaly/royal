// Low-level virtual texture mechanics for renderer tests and internal migration code.
export {
  parseVirtualTextureManifest,
  resolveVirtualTextureManifestPageUri,
} from "./virtual-texture-manifest";
export {
  coalesceVirtualTexturePageTableTexelUploads,
  createVirtualTexturePageTableTexture,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageTableMipDimensions,
} from "./virtual-texture-page-table-texture";
export {
  createVirtualTextureResource,
  VirtualTextureResource,
} from "./virtual-texture-resource";
export {
  VirtualTextureRuntime,
  virtualTexturePageId,
  virtualTextureParentPage,
} from "./virtual-texture-runtime";
export {
  planVirtualTextureUploads,
  splitVirtualTextureUploadPlan,
} from "./virtual-texture-upload-plan";
export type {
  VirtualTextureManifest,
  VirtualTextureManifestFormat,
  VirtualTextureManifestPageSource,
} from "./virtual-texture-manifest";
export type {
  VirtualTexturePageTableMip,
  VirtualTexturePageTableMipOptions,
  VirtualTexturePageTableTexelUploadRange,
  VirtualTexturePageTableTexture,
  VirtualTexturePageTableUploadResult,
} from "./virtual-texture-page-table-texture";
export type {
  CreateVirtualTextureResourceOptions,
  VirtualTextureFrameUploadOptions,
  VirtualTextureFrameUploadResult,
  VirtualTextureMappingStats,
  VirtualTexturePageRequestResult,
  VirtualTexturePageSource,
  VirtualTexturePageSourceInput,
  VirtualTexturePageSourceRequest,
  VirtualTexturePhysicalAtlasTexture,
  VirtualTextureRequestStats,
  VirtualTextureResidentCacheStats,
  VirtualTextureResourceFacade,
  VirtualTextureResourceOptions,
  VirtualTextureResourceStats,
  VirtualTextureResourceUploadBatch,
  VirtualTextureResourceUploadStats,
  VirtualTextureTextureBindings,
  VirtualTextureUvFootprint,
} from "./virtual-texture-resource";
export type {
  VirtualTextureDebugSnapshot,
  VirtualTextureDirtyPageTableEntry,
  VirtualTextureMakeResidentResult,
  VirtualTexturePageAddress,
  VirtualTexturePageId,
  VirtualTexturePageTableCounts,
  VirtualTexturePageTableEntry,
  VirtualTexturePageTableFlag,
  VirtualTexturePhysicalSlot,
  VirtualTextureResidentPage,
  VirtualTextureResolveResult,
  VirtualTextureRuntimeOptions,
  VirtualTextureRuntimeStats,
  VirtualTextureSlotSnapshot,
} from "./virtual-texture-runtime";
export type {
  VirtualTexturePageTableTexelUpload,
  VirtualTexturePhysicalAtlasPageUpload,
  VirtualTextureUploadPlan,
  VirtualTextureUploadPlanBudget,
  VirtualTextureUploadPlanSplit,
  VirtualTextureUploadPlanOptions,
  VirtualTextureWebGl2UploadFormat,
} from "./virtual-texture-upload-plan";
