import { dataUriMediaType } from "../gltf/io";

export const isSvgMimeType = (mimeType: string | undefined): boolean =>
  mimeType?.toLowerCase() === "image/svg+xml";

export const isSvgUri = (uri: string): boolean =>
  uri.startsWith("data:")
    ? isSvgMimeType(dataUriMediaType(uri))
    : /\.svg(?:$|[?#])/iu.test(uri);
