/**
 * Writes bot-vs-bot replays where every sound of the game plays: mining, walking,
 * melee, arrows and towers, building, collapses, chat, a king's fall and the end.
 * The sim bots never find the enemy base under fog, so these march on its
 * mirrored position. "mixed" ends with the king's fall in under 4 minutes;
 * "archers" is a long volley test that never takes the castle.
 *   pnpm --filter @aoa/server exec tsx src/sound-demos.ts [keep]
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createMatch, type PlayerOrder } from "@aoa/engine";
import type { Bot } from "@aoa/sim";
import { rules, type GameEvent, type Order, type PlayerView, type ReplayFile } from "@aoa/shared";
import { saveReplay } from "./app";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const dir = resolve(process.env.REPLAY_DIR ?? resolve(root, "replays"));
const keep = Number(process.argv[2] ?? 2);
const TICK_RATE = 10;
const LATENCY_TICKS = 30;
/** [attacker, defender]: army size that marches out (0 = never), worker count, army cap and what it trains. */
const SETUPS: { name: string; sides: [Demo, Demo] }[] = [
  { name: "mixed", sides: [{ attackAt: 6, workers: 8, maxArmy: 30, army: ["knight", "archer"] }, { attackAt: 0, workers: 5, maxArmy: 3, army: ["knight", "archer"] }] },
  { name: "archers", sides: [{ attackAt: 6, workers: 8, maxArmy: 30, army: ["archer", "archer", "knight"] }, { attackAt: 0, workers: 5, maxArmy: 3, army: ["archer"] }] },
];

interface Demo {
  attackAt: number;
  workers: number;
  maxArmy: number;
  army: string[];
}

const count = (v: PlayerView, kind: string) => v.mine.filter((e) => e.kind === kind).length;

/** Fight what is in range; march on (tx, ty) once `go`, else guard home. */
const script = (go: boolean, tx: number, ty: number, hx: number, hy: number) => `const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e && (${go} || self.distanceToPos(${hx}, ${hy}) <= 8)) self.moveTo(e.x, e.y);
else if (${go}) self.moveTo(${tx}, ${ty});
else if (self.distanceToPos(${hx}, ${hy}) > 3) self.moveTo(${hx}, ${hy});
else self.hold();
`;

/** Workers, one tower, then knights and archers in turn. */
function demo({ attackAt, workers, maxArmy, army: kinds }: Demo): Bot {
  const set: Record<string, string> = {};
  let go = false;
  let next = 0;
  return (v) => {
    const home = v.mine.find((e) => e.kind === "castle");
    if (!home) return [];
    const out: Order[] = [];
    const flip = home.x > 15;
    const army = count(v, "knight") + count(v, "archer");
    go ||= attackAt > 0 && army >= attackAt;
    const code = script(go, 31 - home.x, 31 - home.y, home.x, home.y);
    for (const kind of ["knight", "archer"]) if (set[kind] !== code) out.push({ type: "script", kind, code: (set[kind] = code) });
    let cap = v.players.find((p) => p.id === v.you)!.mineral ?? 0;
    const building = v.mine.some((e) => e.order?.startsWith("build"));
    const builder = v.mine.find((e) => e.kind === "worker");
    if (count(v, "tower") === 0 && !building && builder && count(v, "worker") >= workers) {
      if (cap < 200) return out;
      out.push({ type: "build", unit: builder.id, kind: "tower", x: flip ? 24 : 7, y: flip ? 24 : 7 });
      cap -= 200;
    }
    for (let w = count(v, "worker"); w < workers && cap >= 50; w++, cap -= 50) out.push({ type: "train", building: home.id, kind: "worker" });
    if (count(v, "worker") < workers) return out;
    for (let n = army; n < maxArmy; n++) {
      const kind = kinds[next % kinds.length];
      const cost = kind === "archer" ? 110 : 100;
      if (cap < cost) break;
      out.push({ type: "train", building: home.id, kind });
      cap -= cost;
      next++;
    }
    return out;
  };
}
const LINES = ["Workers, to the mines.", "Towers up, hold the gate.", "They are coming, form up!", "Push to their castle."];

/** Says a line now and then, so the chat sound is heard too. */
const chatty = (bot: Bot, offset: number): Bot => {
  let said = 0;
  return (v) => {
    const out: Order[] = bot(v);
    const due = 150 + offset + said * 900;
    if (said < LINES.length && v.tick >= due) out.push({ type: "chat", text: LINES[said++] });
    return out;
  };
};

async function play(a: Demo, b: Demo, seed: number) {
  const m = await createMatch({ ruleset: rules, seed, tickRate: TICK_RATE, players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  const bots: Record<string, Bot> = { p1: chatty(demo(a), 0), p2: chatty(demo(b), 450) };
  const kinds = new Map(m.spectate().entities.map((e) => [e.id, e.kind]));
  const heard = new Set<string>();
  const orders: ReplayFile["orders"] = [];
  const hashes: Record<number, string> = {};
  try {
    while (!m.outcome) {
      const input: PlayerOrder[] = [];
      for (const [id, bot] of Object.entries(bots)) {
        if (m.tick % LATENCY_TICKS !== (id === "p1" ? 0 : 15)) continue;
        for (const order of bot(m.view(id, m.tick))) input.push({ player: id, order });
      }
      for (const o of input) orders.push({ tick: m.tick, ...o });
      const t = m.tick;
      for (const e of m.step(input).events) note(e, kinds, heard);
      if (t % 100 === 0) hashes[t] = m.hash();
    }
    hashes[m.tick] = m.hash();
    return { a, b, seed, heard, orders, hashes, ticks: m.tick, outcome: m.outcome! };
  } finally {
    m.dispose();
  }
}

function note(e: GameEvent, kinds: Map<string, string>, heard: Set<string>) {
  const building = (k?: string) => ["tower", "wall", "castle", "door"].includes(k ?? "");
  if (e.type === "spawn") {
    kinds.set(e.id, e.kind);
    heard.add(building(e.kind) && e.builder ? "build" : "spawn");
  } else if (e.type === "attack") {
    const k = kinds.get(e.from);
    heard.add(k === "tower" ? "tower" : k === "archer" ? "arrow" : "sword");
  } else if (e.type === "projectile_end" && e.reason !== "miss") heard.add("hit");
  else if (e.type === "death") heard.add(e.kind === "king" ? "horn" : building(e.kind) ? "collapse" : "death");
  else if (e.type === "chat") heard.add("chat");
  else if (e.type === "unload") heard.add("pick");
  else if (e.type === "match_end" && e.outcome.reason === "vital_lost") heard.add("fanfare");
}

const ALL = ["spawn", "build", "sword", "arrow", "tower", "hit", "death", "collapse", "horn", "fanfare", "chat", "pick"];
const results = [];
for (const { name: setup, sides: [a, b] } of SETUPS) for (let seed = 1; seed <= 2; seed++) {
  const r = await play(a, b, seed);
  const missing = ALL.filter((s) => !r.heard.has(s));
  console.log(`setup ${setup} seed ${seed}: ${(r.ticks / 600).toFixed(1)} min, ${r.outcome.reason}${missing.length ? `, missing ${missing.join(" ")}` : ", every sound"}`);
  results.push({ ...r, setup, missing: missing.length });
}
const best = results.sort((x, y) => x.missing - y.missing || x.ticks - y.ticks)
  .filter((r, i, all) => all.findIndex((o) => o.setup === r.setup) === i).slice(0, keep);
for (const r of best) {
  const id = randomBytes(4).toString("hex");
  await saveReplay(dir, {
    format: 1, id, createdAt: new Date().toISOString(), ruleset: rules, seed: r.seed, tickRate: TICK_RATE,
    players: [{ id: "p1", name: `demo:${r.setup}` }, { id: "p2", name: "demo:defend" }],
    orders: r.orders, hashes: r.hashes, finalTick: r.ticks, outcome: r.outcome,
  });
  console.log(`saved /replay/${id}: setup ${r.setup} seed ${r.seed}, ${(r.ticks / 600).toFixed(1)} min`);
}
