/**
 * Internal capability for code that must execute on the renderer-owned GL
 * lane. The symbol keeps the context out of the friendly public API while
 * making borrowing explicit between the WebGL root and its XR shell.
 */
export const rendererOwnedWebGl2Context = Symbol("royal.renderer-owned-webgl2-context");

export interface RendererOwnedWebGl2Context {
  readonly [rendererOwnedWebGl2Context]: WebGL2RenderingContext;
}
