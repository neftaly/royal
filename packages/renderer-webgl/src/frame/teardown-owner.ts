import { captureFirstFailure, type CapturedFailure } from "../captured-failure";

type WebGlFrameTeardownOptions = {
  readonly advanceFrame: () => void;
  readonly bindDefaultFramebuffer: () => void;
  readonly bindDefaultVertexArray: () => void;
  readonly clearArrayBuffer: () => void;
  readonly clearElementArrayBuffer: () => void;
  readonly consumeSurfaceSignals: () => void;
  readonly disableScissor: () => void;
  readonly drainVirtualTextureRequests: () => void;
  readonly endClusteredLights: (frame: number) => void;
  readonly endInstanceTransforms: (commit: boolean) => void;
  readonly finalizeOrdinaryTextureIntent: (commit: boolean) => void;
  readonly finishVirtualTextures: (commit: boolean) => void;
  readonly hasActionableVirtualTextureUploads: () => boolean;
  readonly invalidate: () => void;
  readonly processVirtualTextureUploads: () => void;
  readonly releaseUnusedPackets: () => void;
};

const captureFirstFailureWithArgument = <Argument>(
  first: CapturedFailure | undefined,
  action: (argument: Argument) => void,
  argument: Argument,
): CapturedFailure | undefined => {
  try {
    action(argument);
    return first;
  } catch (value) {
    return first ?? { value };
  }
};

/** Serializes mandatory frame-finalization effects without allocating per-frame callbacks. */
export class WebGlFrameTeardownOwner {
  readonly #options: WebGlFrameTeardownOptions;

  constructor(options: WebGlFrameTeardownOptions) {
    this.#options = options;
  }

  finish(
    renderFailure: CapturedFailure | undefined,
    renderDeferred: boolean,
    frame: number,
    scissorEnabled: boolean,
  ): CapturedFailure | undefined {
    const options = this.#options;
    let failure = captureFirstFailure(renderFailure, options.consumeSurfaceSignals);
    failure = captureFirstFailureWithArgument(
      failure,
      options.endInstanceTransforms,
      failure === undefined && !renderDeferred,
    );
    failure = captureFirstFailure(failure, options.releaseUnusedPackets);
    failure = captureFirstFailureWithArgument(failure, options.endClusteredLights, frame);
    failure = captureFirstFailureWithArgument(
      failure,
      options.finishVirtualTextures,
      failure === undefined && !renderDeferred,
    );
    if (failure === undefined && !renderDeferred) {
      failure = captureFirstFailure(failure, options.processVirtualTextureUploads);
    }
    failure = captureFirstFailureWithArgument(
      failure,
      options.finalizeOrdinaryTextureIntent,
      failure === undefined && !renderDeferred,
    );
    failure = captureFirstFailure(failure, options.advanceFrame);
    failure = captureFirstFailure(failure, options.drainVirtualTextureRequests);
    try {
      if (options.hasActionableVirtualTextureUploads()) options.invalidate();
    } catch (value) {
      failure ??= { value };
    }

    if (scissorEnabled) failure = captureFirstFailure(failure, options.disableScissor);
    failure = captureFirstFailure(failure, options.bindDefaultFramebuffer);
    failure = captureFirstFailure(failure, options.bindDefaultVertexArray);
    failure = captureFirstFailure(failure, options.clearArrayBuffer);
    return captureFirstFailure(failure, options.clearElementArrayBuffer);
  }
}
