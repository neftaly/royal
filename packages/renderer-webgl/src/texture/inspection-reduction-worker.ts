import { loadWorkerRuntime } from "../workers/runtime";
import { reduceInspectionRgba, type InspectionRgba } from "./inspection-rgba";
import { InspectionReadback, INSPECTION_CONTEXT_OPTIONS, type InspectionReadbackSource } from "./inspection-readback";
import { nativeTextureAvailable } from "./native-storage";

const { worker, Transfer } = await loadWorkerRuntime();

let readback: InspectionReadback | undefined;
let context: WebGL2RenderingContext | null | undefined;
const reduce = (input: InspectionRgba) => {
  const result = reduceInspectionRgba(input);
  return new Transfer(result, [result.reduced.buffer]);
};

worker({
  reduce,
  sample: (input: InspectionReadbackSource, dimensions: Omit<InspectionRgba, "rgba">) => {
    try {
      if (context === undefined || context?.isContextLost()) {
        readback?.dispose();
        const canvas = typeof OffscreenCanvas === "undefined" ? undefined : new OffscreenCanvas(1, 1);
        context = canvas?.getContext("webgl2", INSPECTION_CONTEXT_OPTIONS) ?? null;
        readback = canvas === undefined ? undefined : new InspectionReadback(() => canvas);
      }
      // A capability miss may use the shared main-thread readback path. Actual
      // sampling failures reject the task rather than becoming an approval.
      if (context === null || readback === undefined
        || (input.source === undefined && !nativeTextureAvailable(context, input.format, "linear"))) return undefined;
      return reduce({ rgba: readback.read(input), ...dimensions });
    } finally {
      if (input.source instanceof ImageBitmap) input.source.close();
    }
  },
}, { abortListenerTimeout: 0 });
