import { loadWorkerRuntime } from "../workers/runtime";
import { setWorkerGltfCodecUrls, type GltfCodecUrls } from "./codec-loader";
import { executeStaticDracoTasksSerially, type StaticDracoDecodeTask } from "./draco";
import { decodedDracoTaskTransferBuffers } from "./draco-transfer";

const { worker, Transfer } = await loadWorkerRuntime();
worker({
  decodeDraco: async (codecs: GltfCodecUrls, tasks: readonly StaticDracoDecodeTask[]) => {
    setWorkerGltfCodecUrls(codecs);
    const results = await executeStaticDracoTasksSerially(tasks);
    return new Transfer(results, decodedDracoTaskTransferBuffers(results));
  },
});
