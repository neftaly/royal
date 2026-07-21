import { describe, expect, it } from "vitest";
import {
  ETC2_RGBA8_WEBGL_FORMAT,
  ETC2_SRGB8_ALPHA8_WEBGL_FORMAT,
  etc2RgbaWebGlFormat,
} from "../../packages/renderer-webgl/src/texture/etc2-storage";

describe("canonical ETC2 storage", () => {
  it("owns one linear/sRGB WebGL format decision for ordinary and paged uploads", () => {
    expect(etc2RgbaWebGlFormat("linear")).toBe(ETC2_RGBA8_WEBGL_FORMAT);
    expect(etc2RgbaWebGlFormat("srgb")).toBe(ETC2_SRGB8_ALPHA8_WEBGL_FORMAT);
  });
});
