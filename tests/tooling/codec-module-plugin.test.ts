import { beforeEach, expect, it, vi } from "vitest";
import { codecModulePlugin } from "../../scripts/codec-module-plugin";

const { build } = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock("vite", () => ({ build }));
beforeEach(() => build.mockReset());
const output = (code: string, imports: string[] = []) => ({ output: [{
  type: "chunk", code, imports, dynamicImports: [], modules: { "/codec-dependency.js": {} },
}] });
const fixture = () => {
  const plugin = codecModulePlugin();
  const context = { addWatchFile: vi.fn() };
  const load = (plugin.load as Function).bind(context);
  return { context, load, changed: plugin.watchChange as Function };
};

it("invalidates compiled codecs when watched source or dependencies change", async () => {
  build.mockResolvedValueOnce(output("first")).mockResolvedValueOnce(output("second"));
  const { context, load, changed } = fixture();
  expect(await load("/codec.ts?royal-codec-module")).toBe("first");
  expect(await load("/codec.ts?royal-codec-module")).toBe("first");
  expect(build).toHaveBeenCalledTimes(1);
  expect(context.addWatchFile).toHaveBeenCalledWith("/codec-dependency.js");
  changed("/codec-dependency.js", { event: "update" });
  expect(await load("/codec.ts?royal-codec-module")).toBe("second");
});

it("can retry after a failed codec compilation", async () => {
  build.mockRejectedValueOnce(new Error("compile failed")).mockResolvedValueOnce(output("fixed"));
  const { load } = fixture();
  await expect(load("/codec.ts?royal-codec-module")).rejects.toThrow("compile failed");
  expect(await load("/codec.ts?royal-codec-module")).toBe("fixed");
});

it("rejects a codec that could execute an application chunk in a worker", async () => {
  build.mockResolvedValue(output("unsafe", ["app.js"]));
  await expect(fixture().load("/codec.ts?royal-codec-module")).rejects.toThrow("must not import other modules");
});
