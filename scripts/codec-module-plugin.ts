import path from "node:path";
import { build, type Plugin } from "vite";

const urlSuffix = "?royal-codec-url";
const moduleSuffix = "?royal-codec-module";

/** Emit codecs as independent ESM assets shared by application and preparation workers. */
export const codecModulePlugin = (worker = false): Plugin => {
  const compiled = new Map<string, Promise<{ code: string; files: string[] }>>();
  let production = false;
  const compile = (source: string): Promise<{ code: string; files: string[] }> => {
    let result = compiled.get(source);
    if (result === undefined) {
      result = build({
        configFile: false,
        logLevel: "silent",
        build: {
          lib: { entry: source, formats: ["es"], fileName: "codec" },
          minify: "terser",
          sourcemap: false,
          target: "safari17",
          write: false,
          rolldownOptions: { output: { codeSplitting: false } },
        },
      }).then((result) => {
        const outputs = Array.isArray(result) ? result : [result];
        const chunks = outputs.flatMap((output) => "output" in output ? output.output : []);
        if (chunks.length !== 1 || chunks[0]?.type !== "chunk") {
          throw new Error(`Royal codec must emit exactly one self-contained module: ${source}`);
        }
        if (chunks[0].imports.length || chunks[0].dynamicImports.length) {
          throw new Error(`Royal codec must not import other modules: ${source}`);
        }
        return { code: chunks[0].code, files: Object.keys(chunks[0].modules) };
      });
      compiled.set(source, result);
      void result.catch(() => { if (compiled.get(source) === result) compiled.delete(source); });
    }
    return result;
  };
  return {
    name: "royal-codec-module",
    enforce: "pre",
    watchChange: () => { compiled.clear(); },
    configResolved: (config) => { production = config.command === "build"; },
    async resolveId(id, importer) {
      const suffix = id.endsWith(urlSuffix) ? urlSuffix
        : id.endsWith(moduleSuffix) ? moduleSuffix : undefined;
      if (suffix === undefined) return;
      const resolved = await this.resolve(id.slice(0, -suffix.length), importer, { skipSelf: true });
      if (resolved === null) throw new Error(`Cannot resolve Royal codec: ${id}`);
      return resolved.id + suffix;
    },
    async load(id) {
      if (id.endsWith(moduleSuffix)) {
        const source = id.slice(0, -moduleSuffix.length);
        this.addWatchFile(source);
        const result = await compile(source);
        for (const file of result.files) this.addWatchFile(file);
        return result.code;
      }
      if (!id.endsWith(urlSuffix)) return;
      // Worker requests receive the consumer-resolved URLs in their message.
      if (worker) return 'export default "";';
      const source = id.slice(0, -urlSuffix.length);
      this.addWatchFile(source);
      if (!production) return `export default ${JSON.stringify(`/@fs${source}${moduleSuffix}`)};`;
      const result = await compile(source);
      for (const file of result.files) this.addWatchFile(file);
      const reference = this.emitFile({
        type: "asset",
        name: path.basename(source, ".ts") + ".js",
        source: result.code,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
};
