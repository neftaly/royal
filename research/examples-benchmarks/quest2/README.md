# Quest 2 exact-build evidence

These artifacts were captured from clean Royal build `278cbdc7` on a Quest 2
running Oculus Browser 149 and Android 14. The reports carry the complete
source identity; the telemetry sidecars carry device, memory, thermal, battery,
filtered logcat and command outcome data.

- `webxr-vr.json` measures the real 90 Hz immersive session and proves its
  explicit activation and 180/180-frame stereo sample.
- `webxr-vr.telemetry.json` brackets that bounded run with device telemetry.
- `webxr-vr.png` is the physical stereo framebuffer captured while the session
  was active; the capture driver then observed a successful exit.
- `virtual-texture-close.json` records the trusted close-view transition from
  distance 6 to 0.1 and the 5-to-11 resident-page refinement.
- `virtual-texture-close.telemetry.json` brackets the VT run.
- `virtual-texture-close.vt-close.png` is the harness canvas capture;
  `virtual-texture-close.png` retains the physical headset/browser view.

The XR report's supported frame-rate list includes 120 Hz, but this evidence
uses the headset's configured 90 Hz mode. Its p95 is accepted as 60 Hz proof,
not as a sustained 90 or 120 Hz claim.
