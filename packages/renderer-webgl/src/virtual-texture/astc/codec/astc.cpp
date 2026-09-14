// SPDX-License-Identifier: Apache-2.0
// Minimal single-worker ABI. Context and scratch buffers are owned by the caller.
#include "astcenc.h"
#include <cstdint>
#include <cmath>
#include <algorithm>

extern "C" {
astcenc_context* create_encoder(unsigned int block, float quality) {
  astcenc_config config;
  if (astcenc_config_init(ASTCENC_PRF_LDR_SRGB, block, block, 1, quality, 0,
                         &config) != ASTCENC_SUCCESS) return nullptr;
  astcenc_context* context = nullptr;
  if (astcenc_context_alloc(&config, 1, &context, nullptr) != ASTCENC_SUCCESS)
    return nullptr;
  return context;
}

int encode(astcenc_context* context, uint8_t* rgba, unsigned int width,
           unsigned int height, uint8_t* output, unsigned int length) {
  void* slice = rgba;
  astcenc_image image {width, height, 1, ASTCENC_TYPE_U8, &slice};
  const astcenc_swizzle swizzle {ASTCENC_SWZ_R, ASTCENC_SWZ_G,
                               ASTCENC_SWZ_B, ASTCENC_SWZ_A};
  const auto status = astcenc_compress_image(context, &image, &swizzle,
                                            output, length, 0);
  astcenc_compress_reset(context);
  return status;
}

// In-place area filtering, including odd image edges. Average linear RGB
// weighted by alpha, then return straight-alpha sRGB for the next ASTC mip.
void downsample(uint8_t* rgba, unsigned int width, unsigned int height) {
  static float linear[256];
  static bool initialized = false;
  if (!initialized) {
    for (int i = 0; i < 256; ++i) {
      const float c = i / 255.0f;
      linear[i] = c <= 0.04045f ? c / 12.92f : std::pow((c + 0.055f) / 1.055f, 2.4f);
    }
    initialized = true;
  }
  const unsigned int outWidth = std::max(1u, width / 2);
  const unsigned int outHeight = std::max(1u, height / 2);
  for (unsigned int y = 0; y < outHeight; ++y) {
    const double top = double(y) * height / outHeight;
    const double bottom = double(y + 1) * height / outHeight;
    for (unsigned int x = 0; x < outWidth; ++x) {
      const double left = double(x) * width / outWidth;
      const double right = double(x + 1) * width / outWidth;
      double alpha = 0, color[3] = {0, 0, 0};
      for (unsigned int sy = unsigned(top); sy < unsigned(std::ceil(bottom)); ++sy) {
        const double wy = std::min(bottom, double(sy + 1)) - std::max(top, double(sy));
        for (unsigned int sx = unsigned(left); sx < unsigned(std::ceil(right)); ++sx) {
          const double weight = wy * (std::min(right, double(sx + 1)) - std::max(left, double(sx)));
          const auto* source = rgba + (size_t(sy) * width + sx) * 4;
          const double coverage = weight * source[3];
          alpha += coverage;
          for (int c = 0; c < 3; ++c) color[c] += linear[source[c]] * coverage;
        }
      }
      auto* destination = rgba + (size_t(y) * outWidth + x) * 4;
      for (int c = 0; c < 3; ++c) {
        const float value = alpha ? float(color[c] / alpha) : 0;
        const float srgb = value <= 0.0031308f ? value * 12.92f : 1.055f * std::pow(value, 1.0f / 2.4f) - 0.055f;
        destination[c] = uint8_t(std::round(std::max(0.0f, std::min(1.0f, srgb)) * 255));
      }
      destination[3] = uint8_t(std::round(alpha / ((right - left) * (bottom - top))));
    }
  }
}

void destroy_encoder(astcenc_context* context) {
  astcenc_context_free(context);
}
}
