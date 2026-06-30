/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  createSvgGatewayGeometry,
  createSvgRasterTextureSource,
  imageTexture,
  planeGeometry,
  solidTexture,
  type RenderRoot,
  unlitMaterial,
  wireframeMaterial,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import { createElement, type ReactNode } from 'react';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const tigerViewBox = { height: 420, width: 512 } as const;
const tigerWorldScale = 0.00635;
const tigerWorldSize = {
  height: tigerViewBox.height * tigerWorldScale,
  width: tigerViewBox.width * tigerWorldScale,
} as const;
const overlayDepth = 0.08;
const overlayLineWidth = 0.012;

// No Ghostscript tiger asset is committed with the examples app, so this source keeps
// a local tiger-style SVG fixture directly in the example.
const tigerGeometryMarkup = `
  <path id="left-ear" fill="#d65a1f" d="M138 118 L104 36 L191 76 Z"/>
  <path id="right-ear" fill="#d65a1f" d="M374 119 L408 36 L321 76 Z"/>
  <path id="left-inner-ear" fill="#efb36a" d="M137 95 L119 54 L167 78 Z"/>
  <path id="right-inner-ear" fill="#efb36a" d="M375 95 L393 54 L345 78 Z"/>
  <path id="head" fill="#ed7f22" d="M77 252 C62 180 94 105 164 76 C213 17 298 17 348 77 C420 107 451 184 435 256 C421 329 361 384 291 396 C217 409 144 378 105 318 C91 297 82 275 77 252 Z"/>
  <path id="left-cheek-fur" fill="#f2a33a" d="M88 244 C54 254 45 292 77 310 C56 333 78 360 123 343 C111 318 100 281 88 244 Z"/>
  <path id="right-cheek-fur" fill="#f2a33a" d="M424 244 C458 254 467 292 435 310 C456 333 434 360 389 343 C401 318 412 281 424 244 Z"/>
  <path id="forehead" fill="#f5a13a" d="M169 102 C208 70 304 70 342 102 C328 150 302 178 256 184 C210 178 183 150 169 102 Z"/>
  <path id="left-face" fill="#f6a43c" d="M116 191 C127 134 177 93 234 91 C222 160 196 207 149 242 C132 232 121 215 116 191 Z"/>
  <path id="right-face" fill="#f6a43c" d="M396 191 C385 134 335 93 278 91 C290 160 316 207 363 242 C380 232 391 215 396 191 Z"/>
  <path id="nose-bridge" fill="#f28b28" d="M225 164 C236 148 276 148 287 164 L300 242 C288 259 224 259 212 242 Z"/>
  <path id="left-muzzle" fill="#f7e4bd" d="M146 245 C158 213 207 205 242 232 C245 272 221 309 178 312 C143 310 127 277 146 245 Z"/>
  <path id="right-muzzle" fill="#f7e4bd" d="M366 245 C354 213 305 205 270 232 C267 272 291 309 334 312 C369 310 385 277 366 245 Z"/>
  <path id="chin" fill="#fff0c8" d="M200 304 C217 335 295 335 312 304 C300 371 213 371 200 304 Z"/>
  <path id="nose" fill="#1b1514" d="M223 238 C229 222 283 222 289 238 C283 259 230 259 223 238 Z"/>
  <path id="mouth" fill="#2a1614" d="M239 270 C250 286 262 286 273 270 C277 301 235 301 239 270 Z"/>
  <path id="left-eye" fill="#f5f7d2" d="M154 177 C171 155 206 157 222 181 C205 192 173 192 154 177 Z"/>
  <path id="right-eye" fill="#f5f7d2" d="M358 177 C341 155 306 157 290 181 C307 192 339 192 358 177 Z"/>
  <path id="left-iris" fill="#4ca66f" d="M176 176 C176 161 199 161 199 176 C199 191 176 191 176 176 Z"/>
  <path id="right-iris" fill="#4ca66f" d="M313 176 C313 161 336 161 336 176 C336 191 313 191 313 176 Z"/>
  <path id="left-pupil" fill="#10100e" d="M184 176 C184 167 192 167 192 176 C192 185 184 185 184 176 Z"/>
  <path id="right-pupil" fill="#10100e" d="M321 176 C321 167 329 167 329 176 C329 185 321 185 321 176 Z"/>
  <path id="forehead-stripe-center" fill="#13100e" d="M238 82 C250 110 250 139 238 169 L256 188 L274 169 C262 139 262 110 274 82 C262 74 250 74 238 82 Z"/>
  <path id="forehead-stripe-left" fill="#15110f" d="M190 96 C203 116 212 142 213 167 C192 154 176 134 166 110 C172 103 180 99 190 96 Z"/>
  <path id="forehead-stripe-right" fill="#15110f" d="M322 96 C309 116 300 142 299 167 C320 154 336 134 346 110 C340 103 332 99 322 96 Z"/>
  <path id="left-temple-stripe-a" fill="#15110f" d="M111 151 C146 146 177 153 203 172 C161 178 128 174 104 159 Z"/>
  <path id="left-temple-stripe-b" fill="#15110f" d="M98 197 C136 190 169 195 196 213 C156 224 123 221 94 206 Z"/>
  <path id="left-cheek-stripe" fill="#15110f" d="M104 255 C139 244 169 244 195 257 C161 274 130 276 101 265 Z"/>
  <path id="right-temple-stripe-a" fill="#15110f" d="M401 151 C366 146 335 153 309 172 C351 178 384 174 408 159 Z"/>
  <path id="right-temple-stripe-b" fill="#15110f" d="M414 197 C376 190 343 195 316 213 C356 224 389 221 418 206 Z"/>
  <path id="right-cheek-stripe" fill="#15110f" d="M408 255 C373 244 343 244 317 257 C351 274 382 276 411 265 Z"/>
  <path id="left-jaw-stripe" fill="#15110f" d="M135 323 C168 328 196 320 220 298 C205 340 169 355 130 340 Z"/>
  <path id="right-jaw-stripe" fill="#15110f" d="M377 323 C344 328 316 320 292 298 C307 340 343 355 382 340 Z"/>
  <path id="left-brow" fill="#14110f" d="M139 158 C167 135 207 135 232 160 C197 153 167 154 139 158 Z"/>
  <path id="right-brow" fill="#14110f" d="M373 158 C345 135 305 135 280 160 C315 153 345 154 373 158 Z"/>
  <path id="nose-shadow" fill="#6f3420" d="M218 251 C234 263 278 263 294 251 C288 281 224 281 218 251 Z"/>
  <path id="muzzle-left-speckles" fill="#1b1514" d="M169 255 L176 250 L183 255 L176 260 Z M194 272 L201 267 L208 272 L201 277 Z M158 282 L165 277 L172 282 L165 287 Z"/>
  <path id="muzzle-right-speckles" fill="#1b1514" d="M343 255 L336 250 L329 255 L336 260 Z M318 272 L311 267 L304 272 L311 277 Z M354 282 L347 277 L340 282 L347 287 Z"/>
  <path id="left-lower-fur" fill="#d65a1f" d="M154 354 C183 383 228 396 256 388 C222 414 174 398 154 354 Z"/>
  <path id="right-lower-fur" fill="#d65a1f" d="M358 354 C329 383 284 396 256 388 C290 414 338 398 358 354 Z"/>
  <path id="left-whisker-stroke" fill="none" stroke="#2b2019" stroke-width="7" stroke-linecap="round" d="M218 257 C174 247 136 242 100 245 M220 274 C175 277 136 289 101 309 M221 287 C184 306 153 327 125 353"/>
  <path id="right-whisker-stroke" fill="none" stroke="#2b2019" stroke-width="7" stroke-linecap="round" d="M294 257 C338 247 376 242 412 245 M292 274 C337 277 376 289 411 309 M291 287 C328 306 359 327 387 353"/>
`;

const tigerGeometrySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tigerViewBox.width} ${tigerViewBox.height}">
${tigerGeometryMarkup}
</svg>`;

const tigerTextureSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tigerViewBox.width} ${tigerViewBox.height}">
  <rect width="${tigerViewBox.width}" height="${tigerViewBox.height}" rx="28" fill="#fff3d2"/>
  <path fill="#f6d89b" d="M28 380 C92 334 165 344 236 362 C310 381 390 377 484 328 L484 420 L28 420 Z"/>
${tigerGeometryMarkup}
</svg>`;

const svgToDataUri = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const tigerGeometry = createSvgGatewayGeometry(
  { kind: 'svg', svg: tigerGeometrySvg },
  { flattenTolerance: 4, id: 'inline-ghostscript-tiger-style-geometry' },
);

const tigerRasterTexture = createSvgRasterTextureSource({
  height: tigerViewBox.height,
  id: 'inline-ghostscript-tiger-style',
  svg: tigerTextureSvg,
  width: tigerViewBox.width,
});

const tigerMaterial = unlitMaterial({
  texture: imageTexture({
    fallback: solidTexture({ color: [0.95, 0.74, 0.36, 1] }),
    id: tigerRasterTexture.cacheKey,
    revision: tigerRasterTexture.cacheKey,
    src: svgToDataUri(tigerTextureSvg),
  }),
});

const overlayMaterial = unlitMaterial({
  color: [0.02, 0.95, 1, 1],
});
const overlayBoundsMaterial = wireframeMaterial({
  color: [1, 0.92, 0.18, 1],
  width: 2.5,
});
const tigerPlane = planeGeometry({ size: [tigerWorldSize.width, tigerWorldSize.height] });
const overlayLine = boxGeometry({ size: [1, 1, 0.02] });

const worldFromSvgPoint = ({ x, y }: { readonly x: number; readonly y: number }) => ({
  x: (x - tigerViewBox.width / 2) * tigerWorldScale,
  y: (tigerViewBox.height / 2 - y) * tigerWorldScale,
});

const worldBounds = {
  bottom: worldFromSvgPoint({ x: 0, y: tigerGeometry.bounds.maxY }).y,
  left: worldFromSvgPoint({ x: tigerGeometry.bounds.minX, y: 0 }).x,
  right: worldFromSvgPoint({ x: tigerGeometry.bounds.maxX, y: 0 }).x,
  top: worldFromSvgPoint({ x: 0, y: tigerGeometry.bounds.minY }).y,
};

const boundsOverlay = {
  center: [
    (worldBounds.left + worldBounds.right) / 2,
    (worldBounds.bottom + worldBounds.top) / 2,
    overlayDepth,
  ] as const,
  size: [
    worldBounds.right - worldBounds.left,
    worldBounds.top - worldBounds.bottom,
    0.06,
  ] as const,
};

const boundsOverlayGeometry = planeGeometry({ size: [boundsOverlay.size[0], boundsOverlay.size[1]] });

const contourWireSegments = tigerGeometry.contours.flatMap((contour) =>
  contour.points.flatMap((point, index) => {
    const next = contour.points[(index + 1) % contour.points.length];
    if (next === undefined) return [];

    const start = worldFromSvgPoint(point);
    const end = worldFromSvgPoint(next);
    const x = end.x - start.x;
    const y = end.y - start.y;
    const length = Math.hypot(x, y);
    if (length < overlayLineWidth * 2) return [];

    return [{
      position: [(start.x + end.x) / 2, (start.y + end.y) / 2, overlayDepth + 0.025] as const,
      rotation: [0, 0, Math.atan2(y, x)] as const,
      scale: [length, overlayLineWidth, 1] as const,
    }];
  }),
);

export const SvgGateway = (): ReactNode => {
  const scene = (
    <scene>
      <pass clearColor={[0.035, 0.043, 0.046, 1]}>
        <orthographicCamera
          bottom={-1.65}
          far={100}
          left={-2.2}
          near={0.1}
          position={[0, 0, 10]}
          right={2.2}
          rotation={[0, 0, 0]}
          top={1.65}
        />
        <mesh
          geometry={tigerPlane}
          material={tigerMaterial}
          transform={{ position: [0, 0, 0], rotation: [0, 0, 0] }}
        />
        {contourWireSegments.map((segment) => (
          <mesh
            geometry={overlayLine}
            material={overlayMaterial}
            transform={{
              position: segment.position,
              rotation: segment.rotation,
              scale: segment.scale,
            }}
          />
        ))}
        <mesh
          geometry={boundsOverlayGeometry}
          material={overlayBoundsMaterial}
          transform={{ position: boundsOverlay.center, rotation: [0, 0, 0] }}
        />
      </pass>
    </scene>
  ) as RenderRoot;

  return createElement(Canvas, {
    'aria-label': 'SVG gateway tiger raster and geometry overlay',
    children: scene,
    rootOptions,
  });
};
