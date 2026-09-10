export function buildViewLists(lights: readonly { kind: string; position?: readonly number[]; range?: number }[], viewProjection: ArrayLike<number>, options?: { columns?: number; rows?: number; byteBudget?: number }):
  | { kind: 'global'; reason: 'budget' }
  | { kind: 'tiled'; columns: number; rows: number; words: Uint32Array; maxCount: number; meanCount: number; allocatedBytes: number; uploadBytes: number };
