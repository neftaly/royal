import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

type BenchmarkReport = {
  readonly batchPages: number;
  readonly batches: number;
  readonly maxMs: number;
  readonly medianMs: number;
  readonly pageTableMedianMs: number;
  readonly pageTableLogicalPages: number;
  readonly pageTableLookups: number;
  readonly pageTableMotions: number;
  readonly pageTableP95Ms: number;
  readonly p95Ms: number;
  readonly userAgent: string;
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const browserPath = process.env.CHROMIUM_BIN ?? "/usr/bin/chromium";
const retainedBuildDir = process.env.ROYAL_VT_PERF_BUILD_DIR;
const buildDir = retainedBuildDir ?? mkdtempSync(path.join(tmpdir(), "royal-vt-perf-build-"));
const buildOnly = process.argv.includes("--build-only");
const contentType = (filePath: string): string => filePath.endsWith(".js")
  ? "text/javascript"
  : "text/html";
const server = createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
  const relativePath = requestPath === "/"
    ? "scripts/virtual-texture-page-perf.html"
    : requestPath.slice(1);
  const filePath = path.resolve(buildDir, relativePath);
  if (!filePath.startsWith(`${buildDir}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const contents = readFileSync(filePath);
    response.writeHead(200, { "content-type": contentType(filePath) });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
});

const runBrowser = (url: string): Promise<string> => new Promise((resolve, reject) => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "royal-vt-perf-"));
  const browser = spawn(browserPath, [
    "--headless=new",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--virtual-time-budget=30000",
    "--dump-dom",
    url,
  ]);
  let stderr = "";
  let stdout = "";
  const cleanup = (): void => rmSync(userDataDir, { force: true, recursive: true });
  const timeout = setTimeout(() => {
    browser.kill();
    reject(new Error("VT page benchmark browser timed out"));
  }, 30_000);
  browser.stdout.on("data", (chunk: Buffer) => {
    stdout += String(chunk);
  });
  browser.stderr.on("data", (chunk: Buffer) => {
    stderr += String(chunk);
  });
  browser.once("error", (error) => {
    cleanup();
    reject(error);
  });
  browser.once("exit", (code) => {
    clearTimeout(timeout);
    cleanup();
    if (code !== 0) {
      reject(new Error(`VT page benchmark browser exited ${code}: ${stderr}`));
      return;
    }
    resolve(stdout);
  });
});

try {
  await build({
    base: "./",
    configFile: false,
    logLevel: "error",
    publicDir: false,
    root: repoRoot,
    build: {
      emptyOutDir: true,
      outDir: buildDir,
      rollupOptions: {
        input: fileURLToPath(new URL("./virtual-texture-page-perf.html", import.meta.url)),
      },
    },
  });
  if (buildOnly) {
    process.stdout.write(`VT page benchmark built at ${buildDir}\n`);
  } else {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || address === undefined || typeof address === "string") {
      throw new Error("VT page benchmark server did not expose a TCP port");
    }
    const html = await runBrowser(
      `http://127.0.0.1:${address.port}/scripts/virtual-texture-page-perf.html`,
    );
    const encoded = html.match(/data-royal-vt-perf="([^"]+)"/)?.[1];
    if (encoded === undefined || encoded === "pending") {
      throw new Error("VT page benchmark did not publish a report");
    }
    const report = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as BenchmarkReport;
    if (report.batchPages !== 4 || report.batches !== 128 || report.pageTableMotions !== 128) {
      throw new Error(`Invalid VT page benchmark workload: ${JSON.stringify(report)}`);
    }
    if (report.pageTableLookups !== report.pageTableLogicalPages * report.pageTableMotions) {
      throw new Error(`VT page-table lookup invariant failed: ${JSON.stringify(report)}`);
    }
    if (report.medianMs > 4 || report.p95Ms > 8) {
      throw new Error(`Generated VT page batch exceeded budget: ${JSON.stringify(report)}`);
    }
    if (report.pageTableMedianMs > 2 || report.pageTableP95Ms > 5) {
      throw new Error(`VT page-table motion exceeded budget: ${JSON.stringify(report)}`);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }
} finally {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
  if (retainedBuildDir === undefined) rmSync(buildDir, { force: true, recursive: true });
}
