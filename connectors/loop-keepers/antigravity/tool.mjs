// @ts-check
/** A closed command transport for the same eight game MCP tools. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chmod, stat, writeFile, rm } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GAME_TOOLS } from "../../../packages/shared/src/http.ts";

const names = new Set(GAME_TOOLS);
const mcpBin = fileURLToPath(new URL("../../mcp/bin/aoa-mcp.mjs", import.meta.url));
// Resolve the SDK through the package that owns it, including in frozen runs.
const requireMcp = createRequire(new URL("../../mcp/package.json", import.meta.url));
const maxRequestBytes = 512 * 1024;
const timeoutMs = 65_000;

async function connectClient({ server, token }) {
  const { Client } = await import(pathToFileURL(requireMcp.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StdioClientTransport } = await import(pathToFileURL(requireMcp.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href);
  const client = new Client({ name: "aoa-antigravity-command", version: "0.1.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [mcpBin],
      env: { AOA_SERVER: server, AOA_TOKEN: token, AOA_CONNECTOR: "antigravity" },
    }));
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

/** Schemas come from the real MCP server without making a player API call. */
export async function toolDefinitions(config) {
  const client = await connectClient(config);
  try {
    return (await client.listTools()).tools.filter((tool) => names.has(tool.name));
  } finally {
    await client.close();
  }
}

function argumentsObject(args) {
  return args !== null && typeof args === "object" && !Array.isArray(args);
}

function commandRequest(argv) {
  const [name, json] = argv;
  if (argv.length !== 2 || !names.has(name)) {
    throw new Error(`usage: aoa-tool <${GAME_TOOLS.join("|")}> '<JSON object>'`);
  }
  let args;
  try { args = JSON.parse(json); }
  catch { throw new Error("Tool arguments must be valid JSON."); }
  if (!argumentsObject(args)) throw new Error("Tool arguments must be a JSON object.");
  return { name, arguments: args };
}

/**
 * One MCP process for the lifetime of this player. Only the launcher receives
 * credentials; command processes receive a socket path, never a player token.
 * The containing directory must already be private to this OS user. This is a
 * permission boundary for agy's allowed commands, not an OS sandbox.
 */
export async function startToolBridge({ socketPath, server, token }) {
  if ((await stat(dirname(socketPath))).mode & 0o077) throw new Error("The game bridge requires a private directory (mode 0700).");
  // macOS sockaddr_un is shorter than Linux's. Fail clearly rather than bind a
  // silently truncated path shared with another player.
  if (Buffer.byteLength(socketPath) > 100) throw new Error("The game bridge socket path must fit within 100 bytes.");
  const client = await connectClient({ server, token });
  const sockets = new Set();
  let closing;
  let listening = false;
  const local = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(timeoutMs, () => socket.destroy());
    socket.setEncoding("utf8");
    let text = "";
    let handled = false;
    const reply = (payload) => {
      if (!socket.destroyed && socket.writable) socket.end(JSON.stringify(payload) + "\n");
    };
    socket.on("data", async (chunk) => {
      if (handled) return;
      text += chunk;
      if (Buffer.byteLength(text) > maxRequestBytes) {
        handled = true;
        reply({ error: "Game tool request is too large." });
        return;
      }
      const end = text.indexOf("\n");
      if (end < 0) return;
      handled = true;
      try {
        const request = JSON.parse(text.slice(0, end));
        if (!argumentsObject(request) || Object.keys(request).length !== 2 ||
          !names.has(request.name) || !argumentsObject(request.arguments) || text.slice(end + 1).trim()) {
          throw new Error("Invalid bridge request: expected only a game tool name and arguments.");
        }
        // Existing MCP/Zod schemas validate arguments. Never retry mutations or
        // accept host commands, file arguments, endpoint or credential overrides.
        const result = await client.callTool({ name: request.name, arguments: request.arguments });
        reply({ result });
      } catch (error) {
        reply({ error: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.on("end", () => {
      if (!handled) {
        handled = true;
        reply({ error: "Incomplete game tool request." });
      }
    });
  });
  const close = () => {
    if (!closing) closing = (async () => {
      const stopped = listening ? new Promise((resolve) => local.close(resolve)) : Promise.resolve();
      for (const socket of sockets) socket.destroy();
      try { await client.close(); }
      finally {
        await stopped;
        if (listening) await rm(socketPath, { force: true });
      }
    })();
    return closing;
  };
  try {
    const definitions = (await client.listTools()).tools.filter((tool) => names.has(tool.name));
    await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
      local.once("error", reject);
      local.listen(socketPath, () => { local.off("error", reject); listening = true; resolve(); });
    }));
    await chmod(socketPath, 0o600);
    return { socketPath, definitions, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** One request per connection; the long-lived bridge owns the MCP session. */
export async function callTool(argv, { socketPath }) {
  const request = commandRequest(argv);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let text = "";
    let completed = false;
    const fail = (error) => { if (!completed) { completed = true; reject(error); } socket.destroy(); };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => fail(new Error("Game tool bridge timed out. The command was not retried.")));
    socket.on("error", fail);
    socket.on("connect", () => socket.end(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => { text += chunk; });
    socket.on("end", () => {
      if (completed) return;
      try {
        if (!text) throw new Error("Game tool bridge closed before returning a result. The command was not retried.");
        const response = JSON.parse(text);
        if (response.error) throw new Error(response.error);
        if (!response.result) throw new Error("Invalid game tool bridge response.");
        completed = true;
        resolve(response.result);
      } catch (error) { fail(error); }
    });
    socket.on("close", () => {
      if (!completed) fail(new Error("Game tool bridge closed before returning a result. The command was not retried."));
    });
  });
}

/**
 * Only mutation receipts have a known result header followed by a view.
 * @param {[import("../../../packages/shared/src/http.ts").GameTool, string]} argv
 * @param {string} text
 */
function mutationPreview(argv, text) {
  const [name, json] = argv;
  const args = JSON.parse(json); // callTool already validated this object.
  if (name !== "act" && !(name === "script" && args.code !== undefined) && !(name === "chat" && args.text !== undefined)) return null;
  const view = /\n\n(tick \d+ · \d+\.\d+s\/\d+\.\d+s(?: · \d+\.\d+s left)? · (?:waiting|prep|running|finished) · you are [^\s]+)(?:\n|$)/.exec(text);
  if (!view) return null;
  const header = text.slice(0, view.index);
  // Never clip a batch's tail: the final order may be the rejected one.
  if (!header || header.length >= 5000 || header.split("\n").length >= 55) return null;
  return `${header}\n\n${view[1]}`;
}

export async function main(argv, config) {
  try {
    const result = await callTool(argv, config);
    const text = (result.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n");
    // agy clips terminal output by line count as well as bytes. Keep the whole
    // observation available without piping it through arbitrary host commands.
    if (text.length > 6000 || text.split("\n").length > 60) {
      const output = join(config.outputDir, `${randomUUID()}.txt`);
      await writeFile(output, text, { mode: 0o600, flag: "wx" });
      const preview = config.decisionObservations ? mutationPreview(argv, text) : null;
      if (preview) console.log(`${preview}\nUpdated full observation follows with next decision; complete response available at ${output}. Read it with view_file if needed before another action in this turn.`);
      else console.log(`Complete ${argv[0]} result saved to ${output}. Read it with view_file.`);
    } else console.log(text);
    if (result.isError) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
