/** A single agy conversation, driven by fresh player observations rather than strategy. */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { reportActivity } from "../metadata.mjs";
import { seat } from "../game.mjs";

const conversationId = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const terminal = status => status.status === "finished" || status.alive === false;
const observationStatus = text => text.match(/^tick \d+.*? · (waiting|prep|running|finished) · /)?.[1];
const observationOut = text => /^YOU\s+.* · OUT$/m.test(text);

function deferred() {
  let resolve, reject, settled = false;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // A process may exit before the caller reaches this promise.
  promise.catch(() => {});
  return { promise, resolve: value => { if (!settled) { settled = true; resolve(value); } },
    reject: error => { if (!settled) { settled = true; reject(error); } } };
}

/** Only one user event is ever in flight. init grants output reads before any prompt. */
function openSession({ binary, args, env, cwd, conversation, onConversation, signal,
  spawnImpl, output, initTimeoutMs, killAfterMs }) {
  const ready = deferred(), closed = deferred();
  let active, ended = false, initialized = false, pending = "", stopping, terminationRequested = false;
  const managedArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output-format") { i++; continue; }
    if (args[i].startsWith("--output-format=")) continue;
    managedArgs.push(args[i]);
  }
  const child = spawnImpl(binary, ["--project", env.AOA_AGY_PROJECT, "--print-timeout", "15m", ...managedArgs,
    ...(conversation ? ["--conversation", conversation] : []), "--input-format", "stream-json", "--output-format", "stream-json"],
  { cwd, env, stdio: ["pipe", "pipe", "inherit"], detached: process.platform !== "win32" });
  const kill = type => {
    if (ended) return;
    terminationRequested = true;
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, type);
      else child.kill(type);
    } catch (error) { if (error.code !== "ESRCH") child.kill(type); }
  };
  const rejectPending = error => { ready.reject(error); active?.reject(error); active = undefined; };
  function stopSession() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (ended) return;
      // Capture this before rejecting the pending turn. Closing an idle stream
      // is a normal EOF; SIGTERM would manufacture a cancelled ERROR result.
      const cancelTurn = !!active || terminationRequested;
      rejectPending(new Error("Antigravity session stopped"));
      clearTimeout(timer);
      child.stdin.end();
      let graceful, force;
      const terminate = () => {
        kill("SIGTERM");
        force = setTimeout(() => kill("SIGKILL"), killAfterMs);
      };
      if (cancelTurn) terminate();
      else graceful = setTimeout(terminate, killAfterMs);
      try { await closed.promise; }
      finally { clearTimeout(graceful); clearTimeout(force); }
    })();
    return stopping;
  }
  const abort = () => { void stopSession(); };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { rejectPending(new Error("Antigravity did not initialize in time")); kill("SIGTERM"); }, initTimeoutMs);
  const line = raw => {
    if (!raw.trim()) return;
    let event;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.event === "init") {
      if (initialized || !conversationId(event.conversation_id) || (conversation && conversation !== event.conversation_id)) {
        rejectPending(new Error("Antigravity returned an unexpected conversation")); kill("SIGTERM"); return;
      }
      initialized = true;
      Promise.resolve(onConversation(event.conversation_id)).then(() => {
        clearTimeout(timer);
        if (!ended && !signal.aborted) ready.resolve(event.conversation_id);
      }, error => { rejectPending(error); kill("SIGTERM"); });
    } else if (event.event === "result") {
      if (!active) return;
      const turn = active; active = undefined;
      if (event.result?.conversation_id !== conversation || event.result?.status !== "SUCCESS") {
        turn.reject(new Error(`Antigravity decision failed (${event.result?.status || "invalid result"})`));
      } else turn.resolve(event.result);
    }
  };
  child.stdout.on("data", chunk => {
    output(chunk);
    const lines = (pending + chunk).split("\n"); pending = lines.pop(); lines.forEach(line);
  });
  child.stdin.on("error", error => rejectPending(new Error(`Antigravity input failed (${error.code || "stream error"})`)));
  child.on("error", error => rejectPending(new Error(`Antigravity process failed (${error.code || "launch error"})`)));
  child.on("close", (code, signaled) => {
    if (pending) line(pending);
    ended = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
    rejectPending(new Error(`Antigravity exited before its next decision (code ${code ?? signaled})`));
    closed.resolve();
  });
  if (signal.aborted) abort();
  return {
    async initialize() { conversation = await ready.promise; return conversation; },
    async ask(prompt) {
      if (ended || signal.aborted) throw new Error("Antigravity session is closed");
      if (active) throw new Error("An Antigravity decision is already in flight");
      const turn = deferred(); active = turn;
      child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
      return turn.promise;
    },
    stop: stopSession,
  };
}

export async function drivePlayer({ env = process.env, args = [], prompt, onConversation,
  fetchImpl = fetch, spawnImpl = spawn, cwd = process.cwd(), output = chunk => process.stdout.write(chunk),
  pollMs = 1000, minIntervalMs = 1500, retryMs = 2000, maxFailures = 3, initTimeoutMs = 30_000, killAfterMs = 2000 } = {}) {
  if (!env.AOA_TOKEN) throw new Error("set AOA_TOKEN");
  const abort = new AbortController(), game = seat({ env, fetchImpl, signal: abort.signal, redirect: "error" });
  let session, conversation, stopped = false, finished = false, lastDeliveredTick = 0, failures = 0,
    instructionsDelivered = false, interrupted = false, watcher;
  const stop = () => { stopped = true; abort.abort(); };
  const delay = ms => sleep(ms, undefined, { signal: abort.signal });
  const watch = async () => {
    if (stopped) return;
    try { if (terminal(await game.status())) { finished = true; stop(); return; } }
    catch { /* Main loop handles connection failures; a status poll never consumes observations. */ }
    if (!stopped) watcher = setTimeout(watch, pollMs);
  };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    // /status deliberately does not connect a seat. Join once without spending a model turn.
    const initial = await game.observation(0);
    if (observationStatus(initial) === "finished" || observationOut(initial)) return 0;
    watcher = setTimeout(watch, pollMs);
    while (!stopped) {
      try {
        const status = await game.status();
        if (terminal(status)) { finished = true; break; }
        if (status.status !== "running") { await delay(pollMs); continue; }
        if (!session) {
          session = openSession({ binary: env.AOA_AGY_BIN || "agy", args, env, cwd, conversation, signal: abort.signal,
            spawnImpl, output, initTimeoutMs, killAfterMs, onConversation: async id => {
              conversation = id;
              await onConversation(id);
            } });
          await session.initialize();
        }
        // Startup and permission registration may take time. Fetch only after both finish.
        const observation = await game.observation(lastDeliveredTick);
        if (observationStatus(observation) === "finished" || observationOut(observation)) { finished = true; break; }
        if (observationStatus(observation) !== "running") { await delay(pollMs); continue; }
        const tick = Number(observation.match(/^tick (\d+)/)?.[1]);
        const recovery = interrupted ? "The previous decision was interrupted. Some actions may already have taken effect; use this current observation instead of assuming they failed.\n\n" : "";
        const input = `${instructionsDelivered ? "Next decision. The following is your current observation." : prompt}\n\n${recovery}${observation}`;
        const started = Date.now();
        await reportActivity("deciding", { env, fetchImpl });
        await session.ask(input);
        instructionsDelivered = true; interrupted = false; failures = 0;
        if (Number.isFinite(tick)) lastDeliveredTick = tick;
        await reportActivity("between_decisions", { env, fetchImpl });
        await delay(Math.max(0, minIntervalMs - (Date.now() - started)));
      } catch (error) {
        await session?.stop(); session = undefined;
        if (stopped) break;
        if (++failures >= maxFailures) throw new Error(`Antigravity stopped after ${failures} failures: ${error.message}`);
        interrupted = !!conversation;
        console.error(`aoa antigravity: ${error.message}; retrying with the same conversation and observation cursor`);
        const wait = retryMs * failures;
        await reportActivity("connector_retry", { env, fetchImpl, retryAt: new Date(Date.now() + wait).toISOString() });
        await delay(wait).catch(() => {});
      }
    }
    return finished ? 0 : 1;
  } finally {
    stop(); clearTimeout(watcher);
    await session?.stop();
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    await reportActivity("stopped", { env, fetchImpl });
  }
}
