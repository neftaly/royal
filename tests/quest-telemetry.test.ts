import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectLogcatEntries,
  parseBatteryDumpsys,
  parseBrowserMeminfo,
  parseGetprop,
  parseProcMeminfo,
  parseRecordArgs,
  parseThermalDumpsys,
} from "../scripts/quest-telemetry.ts";

describe("Quest telemetry parsing", () => {
  it("normalizes battery level, charging source, and tenths-of-a-degree temperature", () => {
    const battery = parseBatteryDumpsys(`
Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  level: 82
  scale: 100
  temperature: 321
`);

    expect(battery).toEqual({
      charging: true,
      levelPct: 82,
      poweredBy: ["usb"],
      temperatureC: 32.1,
    });
  });

  it("retains thermal status and the hottest sensor of each Android thermal type", () => {
    const thermal = parseThermalDumpsys(`
Thermal Status: 2
Cached temperatures:
  Temperature{mValue=37.25, mType=3, mName=skin, mStatus=1}
  Temperature{mValue=52.5, mType=1, mName=gpu, mStatus=2}
  Temperature{mValue=48.0, mType=1, mName=gpu-backup, mStatus=1}
`);

    expect(thermal).toEqual({
      status: "moderate",
      statusCode: 2,
      temperatures: [
        { name: "gpu", status: "moderate", statusCode: 2, type: 1, valueC: 52.5 },
        { name: "skin", status: "light", statusCode: 1, type: 3, valueC: 37.25 },
      ],
    });
  });

  it("extracts only stable system and browser memory summaries", () => {
    expect(parseProcMeminfo(`
MemTotal:        5980000 kB
MemFree:          240000 kB
MemAvailable:    1620400 kB
Cached:           880000 kB
SwapTotal:       1048572 kB
SwapFree:         900000 kB
`)).toEqual({
      availableKiB: 1_620_400,
      cachedKiB: 880_000,
      freeKiB: 240_000,
      swapFreeKiB: 900_000,
      swapTotalKiB: 1_048_572,
      totalKiB: 5_980_000,
    });

    expect(parseBrowserMeminfo(`
 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           TOTAL PSS:   381200            TOTAL RSS:   524800       TOTAL SWAP PSS:    1024
`)).toEqual({ pssKiB: 381_200, rssKiB: 524_800, swapPssKiB: 1_024 });
  });

  it("selects non-identifying build properties without retaining the complete getprop dump", () => {
    expect(parseGetprop(`
[ro.product.model]: [Quest 2]
[ro.product.manufacturer]: [Oculus]
[ro.product.device]: [hollywood]
[ro.build.version.sdk]: [32]
[ro.build.version.release]: [12]
[ro.build.version.incremental]: [123456789]
[ro.build.fingerprint]: [oculus/hollywood/hollywood:12/example:user/release-keys]
[persist.private.account]: [not-retained]
`)).toEqual({
      androidRelease: "12",
      androidSdk: 32,
      buildFingerprint: "oculus/hollywood/hollywood:12/example:user/release-keys",
      buildIncremental: "123456789",
      device: "hollywood",
      manufacturer: "Oculus",
      model: "Quest 2",
    });
  });

  it("filters, time-bounds, and count-bounds logcat evidence", () => {
    const logs = collectLogcatEntries(`
1720000000.000  100  101 I Unrelated: account-shaped text is ignored
1720000001.000  200  201 W chromium: WebGL context warning
1720000002.000  300  301 E Adreno-GSL: GL_INVALID_OPERATION
1720000003.000  400  401 F DEBUG: Fatal signal in GPU process
`, 1, 1_720_000_001);

    expect(logs).toEqual({
      dropped: 2,
      entries: [{
        level: "warning",
        message: "WebGL context warning",
        pid: 200,
        tag: "chromium",
        tid: 201,
        timestamp: 1_720_000_001,
      }],
    });
  });
});

describe("Quest telemetry command contract", () => {
  it("keeps the wrapped command opaque and resolves only the sidecar path", () => {
    const options = parseRecordArgs([
      "record",
      "--output",
      "reports/run.telemetry.json",
      "--log-limit",
      "8",
      "--",
      "pnpm",
      "--filter",
      "@royal/examples-react",
      "bench:examples",
    ], {
      ADB: "/opt/android/adb",
      ANDROID_SERIAL: "quest-test",
      INIT_CWD: "/tmp/royal-telemetry-test",
    });

    expect(options).toEqual({
      adbPath: "/opt/android/adb",
      command: ["pnpm", "--filter", "@royal/examples-react", "bench:examples"],
      logLimit: 8,
      outputPath: path.resolve("/tmp/royal-telemetry-test/reports/run.telemetry.json"),
      serial: "quest-test",
    });
  });
});
