/**
 * Writes bot-vs-bot replays where every sound of the game plays: mining, walking,
 * melee, arrows and towers, building, collapses, chat, a king's fall and the end.
 * The sim bots never find the enemy base under fog, so these march on its
 * mirrored position. "mixed" ends with the king's fall in under 4 minutes;
 * "archers" is a long volley test that never takes the castle.
 *   pnpm --filter @castellan/server exec tsx src/sound-demos.ts [keep]
 */
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createMatch, type PlayerOrder } from "@castellan/engine";
import { hasBuildOrder, type Bot } from "@castellan/bots";
import { rules, type EntityKind, type GameEvent, type Order, type PlayerView, type RecordedKind, type ReplayFile, type SoundName } from "@castellan/shared";
import { localReplays } from "@castellan/shared/local-data";
import { ReplayArchive } from "./archive";

const archive = new ReplayArchive(resolve(localReplays()));
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
  army: EntityKind[];
}

const FIGHTERS: EntityKind[] = ["knight", "archer"];
const count = (v: PlayerView, kind: EntityKind) => v.mine.filter((e) => e.kind === kind).length;

/** Workers, one tower, then knights and archers in turn. */
function demo({ attackAt, workers, maxArmy, army: kinds }: Demo): Bot {
  const set: Record<string, string> = {};
  let go = false;
  let next = 0;
  return (v) => {
    const home = v.mine.find((e) => e.kind === "castle");
    if (!home) return [];
    const out: Order<EntityKind>[] = [];
    const flip = home.x > 15;
    const army = FIGHTERS.reduce((n, kind) => n + count(v, kind), 0);
    go ||= attackAt > 0 && army >= attackAt;
    // Fight what is in range; march on the mirrored base once `go`, else guard home.
    const [tx, ty, hx, hy] = [31 - home.x, 31 - home.y, home.x, home.y];
    const code = `const e = self.nearestEnemy();
if (e && self.distanceTo(e) <= self.range) self.attack(e);
else if (e && (${go} || self.distanceToPos(${hx}, ${hy}) <= 8)) self.moveTo(e.x, e.y);
else if (${go}) self.moveTo(${tx}, ${ty});
else if (self.distanceToPos(${hx}, ${hy}) > 3) self.moveTo(${hx}, ${hy});
else self.hold();
`;
    for (const kind of FIGHTERS) if (set[kind] !== code) out.push({ type: "script", kind, code: (set[kind] = code) });
    let cap = v.players.find((p) => p.id === v.you)!.mineral ?? 0;
    const building = hasBuildOrder(v);
    const builder = v.mine.find((e) => e.kind === "worker");
    const cost = (kind: EntityKind) => rules.kinds[kind].cost;
    if (count(v, "tower") === 0 && !building && builder && count(v, "worker") >= workers) {
      if (cap < cost("tower")) return out;
      out.push({ type: "build", unit: builder.id, kind: "tower", x: flip ? 24 : 7, y: flip ? 24 : 7 });
      cap -= cost("tower");
    }
    for (let w = count(v, "worker"); w < workers && cap >= cost("worker"); w++, cap -= cost("worker")) out.push({ type: "train", building: home.id, kind: "worker" });
    if (count(v, "worker") < workers) return out;
    for (let n = army; n < maxArmy; n++) {
      const kind = kinds[next % kinds.length];
      if (cap < cost(kind)) break;
      out.push({ type: "train", building: home.id, kind });
      cap -= cost(kind);
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
  const heard = new Set<SoundName>();
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

function note(e: GameEvent, kinds: Map<string, RecordedKind>, heard: Set<SoundName>) {
  const building = (k?: RecordedKind) => !!k && !!rules.kinds[k]?.building;
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

const ALL: SoundName[] = ["spawn", "build", "sword", "arrow", "tower", "hit", "death", "collapse", "horn", "fanfare", "chat", "pick"];
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
  await archive.save({
    format: 1, id, createdAt: new Date().toISOString(), ruleset: rules, seed: r.seed, tickRate: TICK_RATE,
    players: [{ id: "p1", name: `demo:${r.setup}` }, { id: "p2", name: "demo:defend" }],
    orders: r.orders, hashes: r.hashes, finalTick: r.ticks, outcome: r.outcome,
  });
  console.log(`saved /replay/${id}: setup ${r.setup} seed ${r.seed}, ${(r.ticks / 600).toFixed(1)} min`);
}
