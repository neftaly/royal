import type {
  Camera,
  CameraSource,
  CameraViewReadTarget,
  CameraViewSource,
} from "@royal/renderer-core";

export type CanonicalCamera = Camera | CameraViewReadTarget;

export type PreparedCameraSource =
  | Readonly<{ camera: Camera; resource: null }>
  | Readonly<{ camera: CameraViewReadTarget; resource: CameraViewSource }>;

export type CameraSourceOwnerPlatform = Readonly<{
  onCameraChanged(): void;
  onFailure(error: unknown): void;
}>;

const createReadTarget = (): CameraViewReadTarget => ({
  bottom: -1,
  far: 1,
  fovY: Math.PI / 4,
  kind: "perspective-camera",
  left: -1,
  near: 0.1,
  position: new Float64Array(3),
  right: 1,
  rotation: new Float64Array(3),
  top: 1,
});

/** Owns one camera-resource claim and mutates only its retained read target. */
export class CameraSourceOwner {
  #active: PreparedCameraSource | null = null;
  #disposed = false;
  readonly #platform: CameraSourceOwnerPlatform;
  #unsubscribe: (() => void) | null = null;

  constructor(platform: CameraSourceOwnerPlatform) {
    this.#platform = platform;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#active = null;
  }

  prepare(source: CameraSource): PreparedCameraSource {
    if (source.kind !== "camera-view-resource") return { camera: source, resource: null };
    if (this.#active?.resource === source) return this.#active;
    const camera = createReadTarget();
    source.read(camera);
    return { camera, resource: source };
  }

  commit(prepared: PreparedCameraSource): void {
    if (this.#disposed || this.#active === prepared) return;
    let unsubscribe: (() => void) | null = null;
    if (prepared.resource !== null) {
      const resource = prepared.resource;
      const camera = prepared.camera;
      unsubscribe = resource.subscribe(() => {
        if (this.#disposed || this.#active !== prepared) return;
        try {
          resource.read(camera);
          this.#platform.onCameraChanged();
        } catch (error) {
          this.#platform.onFailure(error);
        }
      });
    }
    this.#unsubscribe?.();
    this.#unsubscribe = unsubscribe;
    this.#active = prepared;
  }
}
