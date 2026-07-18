import {
  createCameraViewResource,
  perspectiveCamera,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { CameraSourceOwner } from "../../packages/renderer-webgl/src/surface/camera-source-owner";

describe("camera source lifecycle owner", () => {
  it("reads committed values into retained storage and releases replaced claims", () => {
    const changed = vi.fn();
    const failures = vi.fn();
    const owner = new CameraSourceOwner({
      onCameraChanged: changed,
      onFailure: failures,
    });
    const resource = createCameraViewResource(perspectiveCamera({ position: [0, 0, 3] }));
    const prepared = owner.prepare(resource);
    owner.commit(prepared);
    expect(owner.prepare(resource)).toBe(prepared);
    expect(prepared.camera.position[0]).toBe(0);

    resource.position[0] = 2;
    resource.commit();
    expect(prepared.camera.position[0]).toBe(2);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(failures).not.toHaveBeenCalled();

    owner.commit(owner.prepare(perspectiveCamera({ position: [0, 0, 4] })));
    resource.position[0] = 3;
    resource.commit();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(prepared.camera.position[0]).toBe(2);
  });

  it("contains renderer callback failures instead of breaking camera commits", () => {
    const failure = new Error("frame request failed");
    const onFailure = vi.fn();
    const owner = new CameraSourceOwner({
      onCameraChanged: () => { throw failure; },
      onFailure,
    });
    const resource = createCameraViewResource(perspectiveCamera({}));
    owner.commit(owner.prepare(resource));
    resource.position[0] = 1;
    expect(() => resource.commit()).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});
