/** Session modes defined by the WebXR Device API. */
const XR_SESSION_MODES = ["immersive-ar", "immersive-vr", "inline"] as const;

export type XrSessionMode = (typeof XR_SESSION_MODES)[number];

/**
 * Closed XR lifecycle. `active`, `suspended`, and `ending` own a browser
 * session; `starting` may represent acquisition before one is returned.
 * `available` and `unavailable` are idle capability results, while `blocked`
 * is a denied acquisition on an otherwise supported mode.
 */
export type XrSessionStatus =
  | "active"
  | "available"
  | "blocked"
  | "checking"
  | "ending"
  | "error"
  | "starting"
  | "suspended"
  | "unavailable";

/** Why acquisition failed even though immersive XR remains supported. */
const XR_SESSION_BLOCK_REASONS = [
  "immersive-session-already-active",
  "session-request-denied",
] as const;

export type XrSessionBlockReason = (typeof XR_SESSION_BLOCK_REASONS)[number];

/** Browser-owned visibility states defined by the WebXR Device API. */
const XR_SESSION_VISIBILITY_STATES = [
  "hidden",
  "visible",
  "visible-blurred",
] as const;

export type XrSessionVisibilityState = (typeof XR_SESSION_VISIBILITY_STATES)[number];

export type XrViewport = {
  /** Framebuffer-pixel height. */
  readonly height: number;
  /** Framebuffer-pixel width. */
  readonly width: number;
  /** Framebuffer-pixel horizontal origin. */
  readonly x: number;
  /** Framebuffer-pixel vertical origin. */
  readonly y: number;
};

/** Serializable XR lifecycle and per-frame telemetry exposed to application code. */
export type XrSessionState = {
  /** Latest capability result; independent of a currently owned session's lifecycle. */
  readonly available: boolean;
  /** Present only while `status` is `blocked`. */
  readonly blockReason: XrSessionBlockReason | null;
  /** Latest transition failure, including a rejected session end. */
  readonly error: string | null;
  /** Last recorded XR frame index; reset when session identity changes. */
  readonly frameIndex: number;
  /** Requested or active mode, or `null` when no mode is selected. */
  readonly mode: XrSessionMode | null;
  readonly status: XrSessionStatus;
  /** Browser session visibility while a session is owned. */
  readonly visibilityState: XrSessionVisibilityState | null;
  /** Detached viewport telemetry from the last recorded XR frame. */
  readonly viewports: readonly XrViewport[];
};

/** Browser session ownership kept separate from the serializable snapshot. */
export type XrSessionControlSnapshot<Session extends object = object> = {
  readonly session: Session | null;
};

/** Acquisition state accepted before any browser-owned session exists. */
export type XrSessionStoreInitialState = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
};

export type XrSessionAvailabilityOptions = {
  /** Mode whose capability result was checked. */
  readonly mode?: XrSessionMode | null;
};

export type XrSessionBeginOptions = {
  /** Requested mode; omit when acquisition has not selected one yet. */
  readonly mode?: XrSessionMode | null;
};

export type XrSessionActivationOptions = {
  readonly mode: XrSessionMode;
  readonly visibilityState?: XrSessionVisibilityState;
};

export type XrSessionBlockOptions = {
  /** Mode whose acquisition was blocked. */
  readonly mode?: XrSessionMode | null;
};

export type XrSessionEndOptions = {
  /** Capability result to publish after releasing session ownership. */
  readonly available?: boolean;
};

export type XrSessionFailureOptions = {
  /** Override the retained capability result after failure. */
  readonly available?: boolean;
  /** Mode whose acquisition or runtime failed. */
  readonly mode?: XrSessionMode | null;
};

export type XrSessionFrameRecord = {
  /** Omit to increment the retained index by one. */
  readonly frameIndex?: number;
  /** Omit to preserve the previous viewport telemetry. */
  readonly viewports?: readonly XrViewport[];
};

export const isXrSessionMode = (value: unknown): value is XrSessionMode =>
  XR_SESSION_MODES.some((mode) => mode === value);

export const isXrSessionVisibilityState = (
  value: unknown,
): value is XrSessionVisibilityState =>
  XR_SESSION_VISIBILITY_STATES.some((state) => state === value);

export const isXrSessionBlockReason = (value: unknown): value is XrSessionBlockReason =>
  XR_SESSION_BLOCK_REASONS.some((reason) => reason === value);
