/**
 * The `aoa` commands as plain functions: each takes a client and returns what
 * the CLI prints (text by default, raw JSON with `json`), so tests and other
 * connectors can call them without spawning processes.
 */
import { spawn } from "node:child_process";
import { eventLine, type ChatChannel, type MatchStatus, type Outcome, type PlayerView } from "@aoa/shared";
import { ApiError, query, type Client } from "./client";

export interface Fmt {
  json?: boolean;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const format = (json?: boolean) => (json ? undefined : "text");

export async function rules(c: Client, o: Fmt = {}): Promise<string> {
  return o.json ? pretty(await c.get("/rules")) : c.get<string>("/rules?format=text");
}

export async function state(c: Client, o: Fmt & { since?: number } = {}): Promise<string> {
  const v = await c.get(`/state${query({ since: o.since, format: format(o.json) })}`);
  return o.json ? pretty(v) : (v as string);
}

/** Accepts one order or an array of them. */
export async function act(c: Client, orders: unknown, o: Fmt = {}): Promise<string> {
  const list = Array.isArray(orders) ? orders : [orders];
  const r = await c.post(`/act${query({ format: format(o.json) })}`, { orders: list });
  return o.json ? pretty(r) : (r as string);
}

interface ScriptInfo {
  code: string;
  custom: boolean;
}

/** Prints only the code, so `aoa script knight > k.js` round-trips. */
export async function getScript(c: Client, kind: string, o: Fmt = {}): Promise<string> {
  const s = await c.get<ScriptInfo>(`/scripts/${encodeURIComponent(kind)}`);
  return o.json ? pretty(s) : s.code;
}

/** `code: null` restores the built-in script. */
export async function putScript(c: Client, kind: string, code: string | null, o: Fmt & { lang?: "js" | "ts" } = {}): Promise<string> {
  const r = await c.put(`/scripts/${encodeURIComponent(kind)}${query({ format: format(o.json) })}`, { code, lang: o.lang ?? "js" });
  return o.json ? pretty(r) : (r as string);
}

/** With text: sends publicly, to the team, or to one player. Without: visible history. */
export async function chat(c: Client, text?: string, o: Fmt & { channel?: ChatChannel; to?: string } = {}): Promise<string> {
  if (text === undefined) {
    const r = await c.get(`/chat${query({ format: format(o.json) })}`);
    return o.json ? pretty(r) : (r as string);
  }
  const r = await c.post(`/chat${query({ format: format(o.json) })}`, { text, channel: o.channel, to: o.to });
  return o.json ? pretty(r) : (r as string);
}

export async function wait(c: Client, o: Fmt & { seconds?: number; since?: number; until?: string } = {}): Promise<string> {
  const v = await c.get(`/wait${query({ since: o.since, max: o.seconds, until: o.until, format: format(o.json) })}`);
  return o.json ? pretty(v) : (v as string);
}

/** Note: like every authenticated call, this counts as the player connecting. */
export async function status(c: Client): Promise<MatchStatus> {
  return (await c.get<PlayerView>("/state?since=999999999")).status;
}

/**
 * Long-polls /wait and prints one line per new event (and per status change)
 * until the match finishes. Built for line-based monitors.
 */
export async function watch(c: Client, print: (line: string) => void, o: Fmt & { since?: number } = {}): Promise<Outcome | undefined> {
  let since = o.since ?? (await c.get<PlayerView>("/state?since=999999999")).tick;
  let last: MatchStatus | undefined;
  for (;;) {
    const v = await c.get<PlayerView>(`/wait${query({ since, max: 30 })}`);
    if (v.status !== last) print(o.json ? JSON.stringify({ tick: v.tick, type: "status", status: v.status }) : `[${v.tick}] status ${v.status}`);
    for (const e of v.events) if (e.tick >= since) print(o.json ? JSON.stringify(e) : eventLine(e).trim());
    last = v.status;
    since = v.tick;
    if (v.status === "finished") return v.outcome;
  }
}

interface RoomSummary {
  id: string;
  status: MatchStatus;
  tick: number;
  map?: string;
  mode?: "teams" | "ffa";
  chat?: boolean;
  players: { id: string; name: string; bot?: string; token?: string; side?: number; team?: number }[];
  outcome?: Outcome;
  watch?: string;
}

/** Where each seat's base is on the isometric screen. */
const CORNERS = ["top", "bottom", "right", "left"];

export async function newRoom(
  c: Client,
  o: Fmt & { names?: string[]; bots?: string[]; prepMs?: number; seed?: number; map?: string; sides?: "random" | "fixed"; chat?: boolean; mode?: "teams" | "ffa" } = {},
): Promise<string> {
  const players = [...(o.names ?? []).map((name) => ({ name })), ...(o.bots ?? []).map((bot) => ({ bot }))];
  const r = await c.post<RoomSummary>("/rooms", { players: players.length ? players : undefined, prepMs: o.prepMs, seed: o.seed, map: o.map, sides: o.sides, chat: o.chat, mode: o.mode });
  if (o.json) return pretty(r);
  return [
    `room ${r.id} (${r.status})${r.map ? ` · map ${r.map}` : ""}${r.players.length > 2 && r.mode === "ffa" ? " · free-for-all" : ""}${r.chat ? " · chat on" : ""}`,
    ...r.players.map((p) => {
      const corner = p.side === undefined ? "" : ` [${CORNERS[p.side]} corner]`;
      const team = r.players.length > 2 && r.mode !== "ffa" && p.team !== undefined ? ` team ${p.team}` : "";
      return `${p.id} ${p.name}${corner}${team}  ${p.bot ? `(bot ${p.bot})` : `AOA_TOKEN=${p.token}`}`;
    }),
    `watch ${c.server}${r.watch}`,
  ].join("\n");
}

export async function rooms(c: Client, o: Fmt = {}): Promise<string> {
  const list = await c.get<RoomSummary[]>("/rooms");
  if (o.json) return pretty(list);
  if (!list.length) return "no rooms";
  return list
    .map((r) => {
      const who = r.players.map((p) => `${p.id}:${p.name}${p.bot ? "(bot)" : ""}`).join(" vs ");
      const result = r.outcome ? ` · winner ${r.outcome.winner ?? "draw"} (${r.outcome.reason})` : "";
      return `${r.id} ${r.status} tick ${r.tick} · ${who}${result}`;
    })
    .join("\n");
}

export interface RunOptions {
  /** A run shorter than this counts as a fast failure, whatever its exit code. */
  fastMs?: number;
  maxFastFailures?: number;
  backoffMs?: number;
  log?: (line: string) => void;
}

/**
 * Loop keeper: runs `cmd` and relaunches it (with AOA_RESUME=1) whenever it
 * exits before the match is finished. Returns the exit code for `aoa run`.
 */
export async function run(c: Client, cmd: string[], o: RunOptions = {}): Promise<number> {
  const { fastMs = 10_000, maxFastFailures = 5, backoffMs = 2000, log = (l: string) => console.error(l) } = o;
  let fast = 0;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const code = await exec(cmd, attempt ? { ...process.env, AOA_RESUME: "1" } : process.env);
    let s: MatchStatus | "unreachable";
    try {
      s = await status(c);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        log(`aoa run: ${e.message}`);
        return 1;
      }
      s = "unreachable";
    }
    if (s === "finished") {
      log("aoa run: match finished");
      return 0;
    }
    fast = Date.now() - started < fastMs ? fast + 1 : 0;
    if (fast >= maxFastFailures) {
      log(`aoa run: ${fast} fast exits in a row with the match ${s}; giving up`);
      return 1;
    }
    log(`aoa run: agent exited (code ${code}) with the match ${s}; relaunching with AOA_RESUME=1`);
    await new Promise((r) => setTimeout(r, backoffMs * Math.max(1, fast)));
  }
}

function exec(cmd: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env });
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(code ?? -1));
  });
}
