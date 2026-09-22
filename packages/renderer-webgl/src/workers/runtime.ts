import runtimeUrl from "./workerpool-runtime.ts?royal-codec-url";

type WorkerRuntime = Pick<typeof import("workerpool"), "worker" | "Transfer">;
const runtimeParameter = "royal-worker-runtime";

const inheritedRuntimeUrl = (): string | undefined =>
  typeof document === "undefined" && typeof location !== "undefined"
    ? new URL(location.href).searchParams.get(runtimeParameter) ?? undefined
    : undefined;

/** Pass the consumer-resolved shared runtime URL through nested worker startup. */
export const workerScriptUrl = (script: string): string => {
  const url = new URL(script, import.meta.url);
  url.searchParams.set(runtimeParameter, inheritedRuntimeUrl() ?? new URL(runtimeUrl, import.meta.url).href);
  return url.href;
};

export const loadWorkerRuntime = (): Promise<WorkerRuntime> => {
  const url = inheritedRuntimeUrl();
  if (url === undefined) throw new Error("Royal worker runtime URL is missing");
  return import(/* @vite-ignore */ url) as Promise<WorkerRuntime>;
};
