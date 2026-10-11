/**
 * Evidence runner: creates a room on a live server, plays every castellan seat
 * with its own process (real time, own token only), waits for the end and
 * records the outcome, timings and journal summaries.
 *
 *   pnpm --filter @aoa/castellan evidence --name A1 --seats castellan,rush [--map open] [--mode ffa|teams] [--chat]
 *        [--server http://localhost:4400] [--out evidence]
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ args: process.argv.slice(2), options: {
  name: { type: "string" }, seats: { type: "string", default: "castellan,eco" }, map: { type: "string", default: "open" }, mode: { type: "string" }, chat: { type: "boolean", default: false },
  server: { type: "string", default: process.env.AOA_SERVER ?? "http://localhost:4400" },
  out: { type: "string", default: resolve(here, "../evidence") }, seed: { type: "string" }, prep: { type: "string", default: "5000" }, directive: { type: "string" },
} });
const name = values.name ?? `${values.map}-${values.seats!.replace(/,/g, "-")}-${Date.now().toString(36)}`;
const seats = values.seats!.split(",");
const players = seats.map((s, i) => (s === "castellan" ? { name: `castellan ${String.fromCharCode(65 + i)}` } : { bot: s }));
const body: Record<string, unknown> = { players, map: values.map, chat: values.chat, prepMs: Number(values.prep), ...(values.mode ? { mode: values.mode } : {}), ...(values.seed ? { seed: Number(values.seed) } : {}) };
const res = await fetch(`${values.server}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
if (!res.ok) throw new Error(`room creation failed: ${res.status} ${await res.text()}`);
const room = await res.json() as { id: string; watch: string; players: { id: string; name: string; token?: string; bot?: string; side: number; team: number }[] };
const outDir = join(values.out!, name);
mkdirSync(outDir, { recursive: true });
console.error(`evidence ${name}: room ${room.id} · watch ${values.server}${room.watch}`);
const started = Date.now();
const children = room.players.filter((p) => p.token).map((p) => {
  const args = [resolve(here, "../bin/castellan.mjs"), "--log", outDir, "--name", `${room.id}-${p.id}`];
  const log = join(outDir, `${p.id}.log`);
  const child = spawn(process.execPath, args, { env: { ...process.env, AOA_SERVER: values.server, AOA_TOKEN: p.token!, AOA_DIRECTIVE: values.directive ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: string[] = [];
  child.stdout.on("data", (c) => chunks.push(String(c)));
  child.stderr.on("data", (c) => chunks.push(String(c)));
  const done = new Promise<number>((r) => child.on("exit", (code) => { writeFileSync(log, chunks.join("")); r(code ?? -1); }));
  return { player: p.id, done };
});
const codes = await Promise.all(children.map((c) => c.done));
const summary = await fetch(`${values.server}/rooms/${room.id}`).then((r) => r.json()) as { status: string; outcome?: unknown; timing?: unknown; tick: number; players: unknown[] };
const record = {
  name, room: room.id, createdAt: new Date(started).toISOString(), wallMs: Date.now() - started, map: values.map, mode: values.mode ?? (seats.length === 4 ? "teams" : "1v1"), chat: values.chat,
  seats: room.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, side: p.side, team: p.team })), directive: values.directive ?? null,
  watch: `${values.server}${room.watch}`, replay: `http://localhost:5173/replay/${room.id}`, status: summary.status, outcome: summary.outcome, finalTick: summary.tick, timing: summary.timing,
  exitCodes: Object.fromEntries(children.map((c, i) => [c.player, codes[i]])),
  summaries: room.players.filter((p) => p.token).map((p) => `${name}/${room.id}-${p.id}.md`),
};
writeFileSync(join(outDir, "result.json"), JSON.stringify(record, null, 2));
for (const p of room.players.filter((x) => x.token)) {
  const md = join(outDir, `${room.id}-${p.id}.md`);
  if (existsSync(md)) console.error(readFileSync(md, "utf8").split("\n").slice(0, 8).join("\n"));
}
console.log(JSON.stringify({ name, room: room.id, status: summary.status, outcome: summary.outcome, replay: record.replay }));
