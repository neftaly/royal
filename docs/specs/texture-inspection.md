# Consumer texture inspection

`TextureInspection` is an optional immutable renderer-root policy. The consumer supplies a promise-returning predicate; Royal does not bundle a model or choose classification thresholds.

```tsx
<Canvas
  scene={scene}
  textureInspection={{
    key: "nsfw-policy-v1",
    allow: async (image, signal) => {
      const predictions = await model.classify(image);
      signal.throwIfAborted();
      return isAllowed(predictions);
    },
  }}
/>
```

The imperative API accepts the same object in `createRendererRoot(canvas, { textureInspection })`. `TextureInspection` and `TexturePredicate` are exported from both `@royal/react` and `@royal/renderer-webgl`.

```ts
type TexturePredicate = (
  image: HTMLCanvasElement,
  signal: AbortSignal,
) => Promise<boolean>;

type TextureInspection = Readonly<{
  key: string;
  allow: TexturePredicate;
  concurrency?: number; // integer 1–4, default 1
}>;
```

The image is a read-only borrow, at most 256 pixels on its longest edge. It remains valid until the predicate settles, including after cancellation. Do not retain it, resize it, or modify its pixels. Return exactly `true` to allow display. `false`, a thrown exception, sample-generation failure, or a non-boolean result prevents publication through the existing texture/environment error lifecycle. Pending sources remain loading and unavailable for presentation; ordinary material fallback presentation remains available. Royal never publishes the unapproved source and then removes it later.

The `key` must be non-empty and identify the model and thresholds. Change it when classification semantics change. Root options are immutable; changing the key or concurrency on React `Canvas` replaces the canvas/root and invalidates its old decisions. Callback identity changes with the same key neither replace the root nor invalidate decisions. New inspections use the latest committed callback. `textureInspection` on Canvas takes precedence over the same field in `rendererOptions`.

## Coverage and cost

- Direct images, embedded/external glTF images, and final native compressed images pass inspection before their decoded source becomes ready. This also covers material images used by overlays and alpha-mask picking.
- Inspection samples expose RGB with opaque alpha, including RGB stored beneath transparency. The renderer can use those channels in opaque materials or non-alpha texture slots. Transparent images also supply composites over black and white so opacity-only imagery is inspected. Identical views reuse the same decision; opaque images supply only the RGB view. Displayed texture alpha is unchanged.
- Browser image sources are frozen at their actual decoded/fitted resolution before sampling or display. The predicate receives a reduction of those frozen raster pixels. Browser-supported SVG images follow this same generic path; they are never independently re-rendered as vectors for classification or subsequent zoom refinement.
- Explicit native-preview/full-raster recipes load the full raster when inspection is enabled. A preview cannot approve a different deferred image. Custom decoders returning deferred previews are rejected under this policy; they must provide final pixels.
- Automatic VT uses the inspected source. Its derived pages, mip changes, and ordinary GPU reuploads do not invoke the predicate again.
- Native compressed textures inspect every authored mip before publication. Unlike generated VT mips, these levels can contain independent imagery. Matching sample pixels reuse cached decisions.
- Prefiltered environments inspect a bounded, tone-mapped contact sheet of all six faces at each authored roughness mip before publication. Generated solid colors and internal renderer textures do not invoke the predicate.

Each root admits up to `concurrency` sampling/classification jobs at a time (default 1, maximum 4) and retains at most 1024 completed decisions, including denials/errors, separately from pending work. Queued jobs do not sample or fingerprint pixels until admitted; canceled queued jobs are removed directly. This bounds inspection preparation, not all decoded source storage: upstream texture producers retain queued source ownership and their existing decode budgets. Concurrent consumers share in-flight decisions. Releasing one consumer does not abort work needed by another; releasing all consumers or disposing the root aborts the predicate signal. Predicates should honor cancellation. A predicate that never settles holds its lane and borrowed sample even after cancellation. Cancellation cannot safely release that borrow until the callback settles. A consumer worker pool remains the global compute limit across renderer roots.

Image and environment decisions use a SHA-256 fingerprint of the bounded frozen sample and its dimensions within one immutable policy owner. Identical samples under different asset IDs share decisions; resource ownership and cancellation remain separate. Re-decoding identical content with identical sample pixels reuses its decision; changed pixels or sample dimensions require inspection again. This prevents a URI-only cached decision from approving an SVG whose fitted raster changed. Sampling/fingerprinting can repeat on a new decode even when classification does not. Change asset `version` when bytes at a URI change; `contentKey` asserts equal content across URIs. Eviction or a new root also permits reinspection.

Sampling uses the browser's secure-context Web Crypto API. Image sampling uses a private, reusable offscreen WebGL2 context to expose unpremultiplied RGB before downsampling. Images larger than 256×256 pixels use one lazy workerpool worker per root for GPU upload, readback and reduction; smaller images sample locally. The worker owns a temporary bitmap or compressed-level copy, preserving the display source. Browsers without worker WebGL use the same local readback and transfer its pixels for reduction. Integer-footprint reduction avoids per-texel callbacks while preserving the weighted arithmetic. Each worker request has a 15-second deadline including worker startup and queue time. Cancellation, errors and disposal reject pending work and fail closed; subsequent jobs can replace a failed worker. Workerpool is scoped to inspection. Image freezing, temporary bitmap creation and HDR environment reduction still incur main-thread work. Area integration includes every source texel; authored lower mips are never used to reduce an earlier mip. Environment faces are area-filtered in linear HDR before tone mapping. Compressed sources require support for their native format. Neither that context nor its pixels are presented. Inspection-owned mutable raster snapshots are limited to 64 MiB; each sampled raster or compressed level also has a 64 MiB temporary GPU-storage limit and a 64 MiB decoded RGBA readback limit. Sources exceeding browser framebuffer limits fail inspection. Standalone compressed mips upload as level zero, with padded BC storage cropped to its valid texels. Mips are sampled sequentially rather than retaining a full set of inspection images. With the policy omitted, none of this inspection work runs.

## Limits and adversarial verification

A bounded classification image is not proof that every full-resolution pixel is acceptable. Fine detail can disappear during downsampling. Every authored image/environment mip is inspected; generated pages and mips reuse their inspected source.

Freezing browser images prevents resolution-dependent SVG strokes, animation, or later mutation of a borrowed canvas from changing the approved representation. It does not make a classifier infallible. A later decode yielding a changed inspection sample is a new decision even if its URI has not changed.

`tests/replacement/renderer-webgl-texture-inspection.test.ts` covers policy caching, concurrency, cancellation, failures, disposal, and eviction. Run `pnpm exec vite --host 127.0.0.1` and open `/tests/browser/texture-inspection.html` for real-browser checks of frozen pixels, same-URI changes, pending/blocked publication, SVG non-scaling strokes, transparent RGB, opacity-only content, sparse-grid concealment, native ETC2/BC mip chains, changed environment reloads and roughness mips, automatic page derivation, deferred-preview exclusion, and HDR environment samples. The adversarial fixtures use synthetic colors, not explicit imagery.
