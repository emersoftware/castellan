// Node-only worker entry, bundled to plain JS before spawning. Loading TS via
// parent transform hooks while the parent waits synchronously can deadlock.
import { parentPort, workerData } from "node:worker_threads";
import * as sandbox from "@aoa/sandbox";

const STARTING = 0, IDLE = 1, REQUEST = 2, RESPONSE = 3, FAILED = 4, RUNNING = 5;
const header = workerData.shared ? new Int32Array(workerData.shared, 0, 4) : null;
const bytes = workerData.shared ? new Uint8Array(workerData.shared, 16) : null;
const encoder = new TextEncoder(), decoder = new TextDecoder();

function reply(value, state = RESPONSE) {
  let encoded = encoder.encode(JSON.stringify(value));
  if (encoded.length > bytes.length) encoded = encoder.encode(JSON.stringify({ ok: false, error: "sandbox response exceeds transport limit" }));
  bytes.set(encoded);
  Atomics.store(header, 2, encoded.length);
  Atomics.store(header, 0, state);
  Atomics.notify(header, 0);
}

async function main() {
try {
  await sandbox.initSandbox();
  if (workerData.mode === "host") {
    const host = sandbox.createScriptHost(workerData.limits, workerData.seed);
    Atomics.store(header, 0, IDLE);
    Atomics.notify(header, 0);
    for (;;) {
      for (;;) {
        const state = Atomics.load(header, 0);
        if (state === REQUEST) break;
        Atomics.wait(header, 0, state);
      }
      // Separate time waiting for the OS to schedule this thread from execution.
      // No player code runs before this acknowledgement.
      Atomics.store(header, 0, RUNNING);
      Atomics.notify(header, 0);
      try {
        const size = Atomics.load(header, 1);
        if (size < 1 || size > bytes.length) throw new Error("invalid sandbox request length");
        const request = JSON.parse(decoder.decode(bytes.subarray(0, size)));
        let value;
        if (request.op === "setScript") value = host.setScript(request.kind, request.code);
        else if (request.op === "run") value = host.run(request.world, request.unitIds);
        else throw new Error("invalid sandbox operation");
        reply({ ok: true, value });
      } catch (error) {
        reply({ ok: false, error: String(error?.message ?? error).slice(0, 300) });
      }
    }
  } else {
    // The parent starts the execution deadline after this handshake, so TS/WASM
    // loading is bounded separately and cannot consume a player's run budget.
    parentPort.once("message", request => {
      try {
        const value = request.op === "runOnce"
          ? sandbox.runOnce(request.code, request.input, request.limits)
          : request.op === "validate" ? sandbox.validateScript(request.code, request.limits)
          : (() => { throw new Error("invalid sandbox operation"); })();
        parentPort.postMessage({ type: "result", value });
      } catch (error) {
        parentPort.postMessage({ type: "error", error: String(error?.message ?? error).slice(0, 300) });
      }
    });
    parentPort.postMessage({ type: "ready" });
  }
} catch (error) {
  const message = String(error?.message ?? error).slice(0, 300);
  if (header) reply({ ok: false, error: message }, FAILED);
  else parentPort.postMessage({ type: "error", error: message });
}
}
void main();
