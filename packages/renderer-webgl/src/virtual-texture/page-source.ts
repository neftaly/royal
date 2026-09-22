import type { VirtualTextureLayout, VirtualTexturePageId } from "./layout";

export type DecodedVirtualTexturePage = Readonly<{
  close(): void;
  kind: "image";
  source: TexImageSource;
}>;

/** Cold page production only; residency, publication, and scheduling stay runtime-owned. */
export type VirtualTexturePageSource = Readonly<{
  close?(): void;
  layout: VirtualTextureLayout;
  read(
    page: VirtualTexturePageId,
    signal: AbortSignal,
  ): Promise<DecodedVirtualTexturePage>;
}>;

