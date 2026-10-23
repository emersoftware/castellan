/** The shared-memory protocol between script-isolation.ts and script-worker.mjs. The header holds
 * the worker state and the byte lengths of the last request and response; the transport bytes follow. */
export const STARTING = 0, IDLE = 1, REQUEST = 2, RESPONSE = 3, FAILED = 4, RUNNING = 5;
export const STATE_SLOT = 0, REQUEST_LENGTH_SLOT = 1, RESPONSE_LENGTH_SLOT = 2;
const HEADER_SLOTS = 4;
export const HEADER_BYTES = HEADER_SLOTS * Int32Array.BYTES_PER_ELEMENT;

export function channelViews(shared: SharedArrayBuffer) {
  return { header: new Int32Array(shared, 0, HEADER_SLOTS), bytes: new Uint8Array(shared, HEADER_BYTES) };
}
