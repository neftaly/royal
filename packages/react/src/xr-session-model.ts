/** Session modes defined by the WebXR Device API. */
const XR_SESSION_MODES = ["immersive-ar", "immersive-vr", "inline"] as const;

export type XrSessionMode = (typeof XR_SESSION_MODES)[number];

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
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

/** Serializable XR lifecycle and per-frame telemetry exposed to application code. */
export type XrSessionState = {
  readonly active: boolean;
  readonly available: boolean;
  readonly blockReason: XrSessionBlockReason | null;
  readonly error: string | null;
  readonly frameIndex: number;
  readonly mode: XrSessionMode | null;
  readonly status: XrSessionStatus;
  readonly visibilityState: XrSessionVisibilityState | null;
  readonly viewCount: number;
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
  readonly mode?: XrSessionMode | null;
};

export type XrSessionBeginOptions = {
  readonly mode?: XrSessionMode | null;
};

export type XrSessionActivationOptions = {
  readonly mode: XrSessionMode;
  readonly visibilityState?: XrSessionVisibilityState;
};

export type XrSessionBlockOptions = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
};

export type XrSessionEndOptions = {
  readonly available?: boolean;
};

export type XrSessionFailureOptions = {
  readonly available?: boolean;
  readonly mode?: XrSessionMode | null;
};

export type XrSessionFrameRecord = {
  readonly frameIndex?: number;
  readonly viewCount?: number;
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
