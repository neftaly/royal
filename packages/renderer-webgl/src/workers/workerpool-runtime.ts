// Only the worker-side RPC implementation: no host pool or embedded worker.
import { add } from "workerpool/src/worker.js";
import RuntimeTransfer from "workerpool/src/transfer.js";

export const worker: typeof import("workerpool").worker = add;
export const Transfer: typeof import("workerpool").Transfer = RuntimeTransfer;
