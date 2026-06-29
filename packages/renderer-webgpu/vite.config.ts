import path from "node:path";
import { defineConfig } from "vite";

const failOnRollupWarning = (warning: string | { readonly message?: string }): never => {
  const message = typeof warning === "string" ? warning : warning.message ?? JSON.stringify(warning);
  throw new Error("Rollup warning treated as error: " + message);
};

export default defineConfig({
  build: {
    lib: {
      entry: {
        capabilities: "src/capabilities.ts",
        index: "src/index.ts",
        "render-probe": "src/render-probe.ts",
        "scene-probe": "src/scene-probe.ts"
      },
      fileName: (_format, entryName) => entryName + ".js",
      formats: ["es"]
    },
    rollupOptions: {
      external: ["@royal/renderer-core"],
      onwarn: failOnRollupWarning
    },
    sourcemap: true,
    target: "safari17"
  },
  resolve: {
    alias: {
      "@royal/renderer-core": path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "../renderer-core/src/index.ts"
      )
    }
  }
});
