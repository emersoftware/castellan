// Node-only worker entry, bundled to plain JS before spawning. Loading TS via
// parent transform hooks while the parent waits synchronously can deadlock.
import { parentPort, workerData } from "node:worker_threads";
import * as sandbox from "@castellan/sandbox";
import { channelViews, FAILED, IDLE, REQUEST, REQUEST_LENGTH_SLOT, RESPONSE, RESPONSE_LENGTH_SLOT, RUNNING, STATE_SLOT } from "./script-channel.ts";

const { header, bytes } = workerData.shared ? channelViews(workerData.shared) : { header: null, bytes: null };
const encoder = new TextEncoder(), decoder = new TextDecoder();

function reply(value, state = RESPONSE) {
  let encoded = encoder.encode(JSON.stringify(value));
  if (encoded.length > bytes.length) encoded = encoder.encode(JSON.stringify({ ok: false, error: "sandbox response exceeds transport limit" }));
  bytes.set(encoded);
  Atomics.store(header, RESPONSE_LENGTH_SLOT, encoded.length);
  Atomics.store(header, STATE_SLOT, state);
  Atomics.notify(header, STATE_SLOT);
}

/** A player's persistent VM: answers requests over shared memory until the parent terminates this thread. */
function serve(host) {
  Atomics.store(header, STATE_SLOT, IDLE);
  Atomics.notify(header, STATE_SLOT);
  for (;;) {
    for (let state = Atomics.load(header, STATE_SLOT); state !== REQUEST; state = Atomics.load(header, STATE_SLOT)) Atomics.wait(header, STATE_SLOT, state);
    // Separate time waiting for the OS to schedule this thread from execution.
    // No player code runs before this acknowledgement.
    Atomics.store(header, STATE_SLOT, RUNNING);
    Atomics.notify(header, STATE_SLOT);
    try {
      const size = Atomics.load(header, REQUEST_LENGTH_SLOT);
      if (size < 1 || size > bytes.length) throw new Error("invalid sandbox request length");
      /** @type {import("./script-isolation").WorkerRequest} */
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
}

/** One /run or validation in a fresh VM. The parent starts the execution deadline after the
 * ready handshake, so TS/WASM loading is bounded separately and cannot consume a player's run budget. */
function answerOnce() {
  parentPort.once("message", (/** @type {import("./script-isolation").WorkerRequest} */ request) => {
    /** @type {import("./script-isolation").WorkerMessage} */
    let message;
    try {
      if (request.op === "runOnce") message = { type: "result", value: sandbox.runOnce(request.code, request.input, request.limits) };
      else if (request.op === "validate") message = { type: "result", value: sandbox.validateScript(request.code, request.limits) };
      else throw new Error("invalid sandbox operation");
      parentPort.postMessage(message);
    } catch (error) {
      parentPort.postMessage({ type: "error", error: String(error?.message ?? error).slice(0, 300) });
    }
  });
  parentPort.postMessage({ type: "ready" });
}

async function main() {
  try {
    await sandbox.initSandbox();
    if (workerData.mode === "host") serve(sandbox.createScriptHost(workerData.limits, workerData.seed));
    else answerOnce();
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 300);
    if (header) reply({ ok: false, error: message }, FAILED);
    else parentPort.postMessage({ type: "error", error: message });
  }
}
void main();
