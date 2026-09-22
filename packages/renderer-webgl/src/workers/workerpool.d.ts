declare module "workerpool/src/worker.js" {
  export const add: typeof import("workerpool").worker;
}
declare module "workerpool/src/transfer.js" {
  const Transfer: typeof import("workerpool").Transfer;
  export default Transfer;
}
