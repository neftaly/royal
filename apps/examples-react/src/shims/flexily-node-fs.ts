const unavailable = (): never => {
  throw new Error('node:fs is not available in the browser');
};

export const closeSync = unavailable;
export const openSync = unavailable;
export const writeSync = unavailable;
