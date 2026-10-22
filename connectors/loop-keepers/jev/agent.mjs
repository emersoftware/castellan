// @ts-check
// Planner and chooser, as in the Astra + Jev Minecraft agent: a planner model
// reads the rules and the full observation and returns a plan with numeric
// targets; code turns the game into complete, bounded actions that still advance
// those targets; Jev picks one per decision from a compact summary. The planner
// also owns language: its plan may carry a chat message and unit scripts. Unit
// scripts remain the reflex layer, as code does in the drone controller.
//   plan (async: first, on targets met, failures, empty menu, every 20 s) → summarize → options → Jev picks one → act → repeat
import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { launchConfiguration, reportActivity, reportConfiguration } from "../metadata.mjs";
import { observedSeat, seat, seatOver, serverUrl } from "../game.mjs";
import { promptOf } from "../turns.mjs";
import { dist as tileDistance } from "../../../packages/shared/src/geometry.ts";
import { loadKey } from "../opencode/agent.mjs";

const DEFAULT_JEV = "typesafe/jev-1.14";
const DEFAULT_PLANNER = "~deepseek/deepseek-flash-latest";
const OPENROUTER = "https://openrouter.ai/api";
const ARMY = ["knight", "archer"];
const SCRIPTABLE = ["worker", "knight", "archer", "tower", "castle", "king"];
const REPLAN_MS = 20_000, FAILED_MS = 10_000;

function options(args) {
  const { values } = parseArgs({ args, options: {
    jev: { type: "string", default: DEFAULT_JEV },
    planner: { type: "string", default: DEFAULT_PLANNER },
    effort: { type: "string", default: "low" },
    interval: { type: "string", default: "1000" },
  } });
  for (const model of [values.jev, values.planner]) if (!/^[\w.~-]+\/[\w.~:/-]+$/.test(model)) throw new Error("models must be provider/model-id");
  return { jev: values.jev, planner: values.planner, effort: values.effort, intervalMs: Math.max(0, Number(values.interval) || 0) };
}

/** The game distance the model's ranges use. */
const dist = (a, b) => tileDistance(a.x, a.y, b.x, b.y);
const nearest = (list, p) => list.reduce((a, b) => (dist(b, p) < dist(a, p) ? b : a), list[0]);
const tally = list => list.reduce((c, k) => ({ ...c, [k]: (c[k] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({}));

/** What the player owns, counted by code: alive, queued at castles, under construction, upgrade levels. */
function holdings(view) {
  const me = view.players.find(p => p.id === view.you);
  const alive = tally(view.mine.filter(e => !e.ruin).map(e => e.kind));
  const queued = tally(view.mine.flatMap(e => (e.training ?? []).map(t => t.kind)));
  const building = tally(view.mine.filter(e => e.construction).map(e => e.construction.kind));
  const levels = { ...(me?.upgrades ?? {}) };
  if (me?.research) levels[me.research.upgrade] = Math.max(levels[me.research.upgrade] ?? 0, me.research.level);
  const total = kind => (alive[kind] ?? 0) + (queued[kind] ?? 0) + (building[kind] ?? 0) + (levels[kind] ?? 0);
  return { me, alive, queued, building, levels, total };
}

/** What the plan still asks for. */
function needs(view, plan) {
  const h = holdings(view);
  return Object.fromEntries(Object.entries(plan?.targets ?? {}).map(([k, want]) => /** @type {[string, number]} */ ([k, Math.max(0, Number(want) - h.total(k))])).filter(([, n]) => n > 0));
}

/** Free tiles near my castles, one per direction, plus a tile beside each deposit group far from them. */
function buildSites(view) {
  const castles = view.mine.filter(e => e.kind === "castle");
  const anchor = castles.length ? castles : view.mine.filter(e => e.vital);
  const free = (x, y) => view.grid[y]?.[x] === "·" && view.visibility[y]?.[x] === "2";
  const sites = new Map();
  for (const c of anchor) {
    const best = new Map();
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = c.x + dx, y = c.y + dy, d = dist(c, { x, y });
      if (d < 2 || !free(x, y)) continue;
      const dir = `${dy < 0 ? "N" : dy > 0 ? "S" : ""}${dx < 0 ? "W" : dx > 0 ? "E" : ""}`;
      if (!best.has(dir) || best.get(dir).d > d) best.set(dir, { x, y, d, dir });
    }
    for (const s of best.values()) sites.set(`${s.x},${s.y}`, { x: s.x, y: s.y, text: `${s.d} tiles ${s.dir} of my ${c.kind} ${c.id}` });
  }
  const far = view.deposits.filter(d => anchor.every(c => dist(c, d) > 6));
  /** @type {typeof far[]} */
  const groups = [];
  for (const d of far) (groups.find(g => dist(g[0], d) <= 3) ?? (groups.push([]), groups.at(-1))).push(d);
  for (const g of groups) {
    const cx = Math.round(g.reduce((s, d) => s + d.x, 0) / g.length), cy = Math.round(g.reduce((s, d) => s + d.y, 0) / g.length);
    let site;
    for (let r = 1; r <= 3 && !site; r++) for (let dy = -r; dy <= r && !site; dy++) for (let dx = -r; dx <= r && !site; dx++) {
      if (["·", ":"].includes(view.grid[cy + dy]?.[cx + dx])) site = { x: cx + dx, y: cy + dy };
    }
    if (site) sites.set(`${site.x},${site.y}`, { ...site, text: `beside deposits ${g.map(d => d.id).join(",")} (${g.reduce((s, d) => s + d.amount, 0)} mineral)` });
  }
  return [...sites.values()];
}

/** Regions of 8×8 tiles that are mostly unexplored, nearest to my base first. */
function regions(view, base) {
  const h = view.grid.length, w = view.grid[0]?.length ?? 0, out = [];
  for (let y0 = 0; y0 < h; y0 += 8) for (let x0 = 0; x0 < w; x0 += 8) {
    let unexplored = 0, n = 0;
    for (let y = y0; y < Math.min(h, y0 + 8); y++) for (let x = x0; x < Math.min(w, x0 + 8); x++, n++) if (view.visibility[y][x] === "0") unexplored++;
    if (unexplored / n > 0.5) out.push({ x: Math.min(w - 1, x0 + 4), y: Math.min(h - 1, y0 + 4), unexplored: Math.round(100 * unexplored / n) });
  }
  return base ? out.sort((a, b) => dist(a, base) - dist(b, base)) : out;
}

/**
 * Every complete action that would send at least one new order and, where the plan
 * sets a target, still moves toward it. Keys are stable so a rejected one can rest.
 */
export function candidates(view, plan, failed = new Map(), now = Date.now()) {
  const h = holdings(view), want = needs(view, plan), out = [];
  const add = (key, description, orders) => { if ((failed.get(key) ?? 0) <= now && orders.length) out.push({ key, description, orders }); };
  const castles = view.mine.filter(e => e.kind === "castle");
  const base = castles[0] ?? view.mine.find(e => e.vital);
  const free = view.mine.filter(u => ["worker", ...ARMY].includes(u.kind) && !u.construction && !/^build /.test(u.order ?? ""));
  const army = free.filter(u => ARMY.includes(u.kind));
  const workers = free.filter(u => u.kind === "worker");
  const idleWorkers = workers.filter(u => !u.order && u.doing === "hold");
  const actions = view.availableActions ?? { train: [], build: [], research: [] };
  const have = k => `you have ${h.alive[k] ?? 0}${h.queued[k] ? ` + ${h.queued[k]} queued` : ""}${h.building[k] ? ` + ${h.building[k]} being built` : ""}, plan target ${plan?.targets?.[k] ?? 0}`;

  for (const t of actions.train) if (!t.blockedBy.length && want[t.kind]) add(`train:${t.building}:${t.kind}`, `Train a ${t.kind} at ${t.building} (cost ${t.cost}, queue ${t.queue}/${t.queueLimit}); ${have(t.kind)}`, [{ type: "train", building: t.building, kind: t.kind }]);
  for (const r of actions.research) if (!r.blockedBy.length && want[r.upgrade]) add(`upgrade:${r.upgrade}`, `Research ${r.upgrade} level ${r.level} (cost ${r.cost}); plan target level ${plan.targets[r.upgrade]}`, [{ type: "upgrade", upgrade: r.upgrade }]);
  const sites = actions.build.some(b => !b.blockedBy.length && want[b.kind]) && workers.length ? buildSites(view) : [];
  for (const b of actions.build) if (!b.blockedBy.length && want[b.kind]) for (const s of sites.slice(0, 4)) {
    const w = nearest(workers, s);
    add(`build:${b.kind}:${s.x},${s.y}`, `Build a ${b.kind} at (${s.x},${s.y}), ${s.text}, with worker ${w.id} ${dist(w, s)} tiles away (cost ${b.cost} on completion); ${have(b.kind)}`, [{ type: "build", unit: w.id, kind: b.kind, x: s.x, y: s.y }]);
  }
  const enemies = view.enemy.filter(e => e.owner !== "neutral").sort((a, b) => (base ? dist(a, base) - dist(b, base) : 0)).slice(0, 6);
  for (const e of enemies) {
    const units = army.filter(u => u.order !== `attack ${e.id}`);
    add(`attack:${e.id}`, `Send ${units.length} army units (${units.map(u => u.kind).join(", ")}) to attack ${e.kind} ${e.id} of ${e.owner} at (${e.x},${e.y}), hp ${e.hp}/${e.maxHp}${base ? `, ${dist(e, base)} tiles from my base` : ""}`, units.map(u => ({ type: "attack", unit: u.id, target: e.id })));
  }
  const wp = plan?.waypoint;
  if (wp) {
    const units = army.filter(u => dist(u, wp) > 2 && u.order !== `move ${wp.x},${wp.y}`);
    add("waypoint", `Move ${units.length} army units to the plan's waypoint (${wp.x},${wp.y})`, units.map(u => ({ type: "move", unit: u.id, x: wp.x, y: wp.y })));
  }
  if (idleWorkers.length) for (const d of view.deposits.filter(d => d.amount > 0).sort((a, b) => (base ? dist(a, base) - dist(b, base) : 0)).slice(0, 3))
    add(`gather:${d.id}`, `Send ${idleWorkers.length} idle workers to mine deposit ${d.id} (${d.amount} mineral at (${d.x},${d.y})${base ? `, ${dist(d, base)} tiles from my base` : ""})`, idleWorkers.map(u => ({ type: "gather", unit: u.id, deposit: d.id })));
  // A unit already on its way somewhere is not re-sent: scouting goes to a unit with no move order.
  const idleArmy = army.filter(u => !u.order);
  const scouts = (idleArmy.length ? idleArmy : workers).filter(u => !/^move /.test(u.order ?? ""));
  if (scouts.length) for (const r of regions(view, base).slice(0, 3)) {
    const u = nearest(scouts, r);
    add(`scout:${r.x},${r.y}`, `Send ${u.kind} ${u.id} to scout around (${r.x},${r.y}), ${r.unexplored}% unexplored, ${dist(u, r)} tiles away`, [{ type: "move", unit: u.id, x: r.x, y: r.y }]);
  }
  return out;
}

/** What Jev reads: a compact summary computed by code, about 1-2 KB. */
export function summary(view, plan, recent) {
  const h = holdings(view), base = view.mine.find(e => e.kind === "castle") ?? view.mine.find(e => e.vital);
  const enemies = view.enemy.filter(e => e.owner !== "neutral");
  return {
    you: view.you,
    secondsLeft: Math.round((view.matchMs - view.timeMs) / 1000),
    mineral: h.me?.mineral, population: `${h.me?.pop}/${h.me?.popCap}`,
    own: h.alive, queued: h.queued, beingBuilt: h.building, upgrades: h.levels,
    plan: plan ? { objective: plan.objective, notes: plan.notes, waypoint: plan.waypoint ?? null, stillNeeded: needs(view, plan) } : null,
    enemiesWithin8OfBase: base ? enemies.filter(e => dist(e, base) <= 8).length : 0,
    visibleEnemies: enemies.slice(0, 8).map(e => ({ kind: e.kind, owner: e.owner, at: `${e.x},${e.y}`, ...(base ? { tilesFromBase: dist(e, base) } : {}) })),
    underAttack: (view.underAttack ?? []).slice(0, 6).map(a => ({ kind: a.kind, id: a.id, damage: a.damage })),
    playersAlive: view.players.filter(p => p.alive).map(p => p.id),
    recentActions: recent.slice(-5),
  };
}

/** One Jev Choice over the options, keyed a0..aN. */
export function jevClient({ key, model, fetchImpl = fetch }) {
  return async (state, options) => {
    const started = Date.now();
    const criteria = Object.fromEntries(options.map((o, i) => [`a${i}`, o.description]));
    const res = await fetchImpl(`${OPENROUTER}/alpha/decisions`, { method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, state: [JSON.stringify(state)], questions: { action: { type: "choice",
        instructions: "Choose the one available action that best advances your planner's current objective.", criteria } } }) });
    if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
    const body = await res.json(), answer = body.answers?.action;
    const selected = options[Number(String(answer?.choice).slice(1))];
    if (!selected) throw new Error("Jev answered no offered action");
    return { selected, confidence: answer.confidence, probabilities: answer.probabilities, ms: Date.now() - started, cost: body.usage?.cost ?? 0 };
  };
}

/** The planner keeps one conversation per match (its last exchanges) and answers with a JSON plan. */
function plannerSession({ key, model, effort, rules, you, goal, fetchImpl = fetch }) {
  const system = { role: "system", content: `You are the planner for player ${you} in Castellan. ${goal}
Another model chooses each order from bounded actions built from your plan: it trains or builds only toward your targets, attacks visible enemies, moves the army to your waypoint, sends idle workers to mine, and scouts.
Reply with a JSON object: objective (string); targets (object: unit or building kind → total wanted, counting alive, queued and under construction; upgrade id → level); waypoint ({x,y} where the army goes when told, or null); notes (string); optionally message ({to: a player id or "all", text: at most 200 characters}); optionally scripts (object: unit kind → JavaScript function body, at most 4096 bytes, installed as that kind's per-tick script).

${rules}` };
  let history = [], cost = 0;
  return {
    get cost() { return cost; },
    async plan(content) {
      const messages = [system, ...history, { role: "user", content }];
      const res = await fetchImpl(`${OPENROUTER}/v1/chat/completions`, { method: "POST", signal: AbortSignal.timeout(180_000),
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, reasoning: { effort }, response_format: { type: "json_object" }, messages }) });
      if (!res.ok) throw new Error(`planner HTTP ${res.status}`);
      const body = await res.json();
      cost += body.usage?.cost ?? 0;
      const text = String(body.choices?.[0]?.message?.content ?? "");
      const plan = parsePlan(text);
      history = [...history, { role: "user", content }, { role: "assistant", content: text }].slice(-12);
      return plan;
    },
  };
}

export function parsePlan(text) {
  const plan = JSON.parse(text.replace(/^```\w*\n?|\n?```\s*$/g, ""));
  if (typeof plan.objective !== "string" || typeof plan.targets !== "object" || !plan.targets) throw new Error("plan without objective or targets");
  return { objective: plan.objective, targets: plan.targets, waypoint: plan.waypoint && Number.isFinite(plan.waypoint.x) && Number.isFinite(plan.waypoint.y) ? { x: Math.round(plan.waypoint.x), y: Math.round(plan.waypoint.y) } : null,
    notes: String(plan.notes ?? ""), message: plan.message?.text ? { to: plan.message.to, text: String(plan.message.text).slice(0, 200) } : null,
    scripts: plan.scripts && typeof plan.scripts === "object" ? Object.fromEntries(Object.entries(plan.scripts).filter(([k, c]) => SCRIPTABLE.includes(k) && typeof c === "string")) : {} };
}

export async function play({ env = process.env, args = process.argv.slice(2), fetchImpl = fetch } = {}) {
  if (!env.CASTELLAN_TOKEN) throw new Error("set CASTELLAN_TOKEN");
  const opts = options(args);
  const key = await loadKey(env);
  if (!key) throw new Error("set OPENROUTER_API_KEY, save it in ~/.config/castellan/openrouter-api-key, or log in with `opencode auth login`");
  const runs = join(homedir(), ".local", "state", "castellan", "jev");
  await mkdir(runs, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(runs, "run-"));
  const goal = promptOf(env);
  console.error(`castellan jev: ${opts.planner} (${opts.effort}) plans, ${opts.jev} chooses; logs ${root}`);
  await reportConfiguration(launchConfiguration({ connector: "jev", model: `${opts.planner}+${opts.jev}`, effort: opts.effort, prompt: goal, env }), { env, fetchImpl });

  const server = serverUrl(env.CASTELLAN_SERVER);
  const abort = new AbortController();
  const api = async (method, path, body) => {
    const res = await fetchImpl(server + path, { method, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
      headers: { authorization: `Bearer ${env.CASTELLAN_TOKEN}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) throw new Error(`game HTTP ${res.status}: ${typeof json === "string" ? json : json.error ?? ""}`);
    return json;
  };
  const game = seat({ env, fetchImpl, signal: abort.signal });
  const choose = jevClient({ key, model: opts.jev, fetchImpl });
  const journal = line => appendFile(join(root, "decisions.jsonl"), JSON.stringify({ at: Date.now(), ...line }) + "\n", { mode: 0o600 });
  const recent = [], failed = new Map();
  let stopped = false, finished = false, failures = 0, rejections = 0, jevCost = 0, decisions = 0;
  /** @type {ReturnType<typeof plannerSession> | undefined} */
  let planner;
  let plan = null, planning = null, lastPlanAt = 0, plans = 0;
  // The chooser and the planner each read events since their own previous observation;
  // the server's default cursor would hand each one only what the other had not consumed.
  let chooserSince = 0, plannerSince = 0;
  const stop = () => { stopped = true; abort.abort(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);

  const plannerObservation = async () => {
    const observation = await game.observation(plannerSince);
    const { tick } = observedSeat(observation);
    if (Number.isFinite(tick)) plannerSince = tick;
    return observation;
  };

  /** Asks for a plan beside the loop; the plan's message and scripts are carried out by code. */
  const replan = (view, reason, menu) => {
    lastPlanAt = Date.now();
    planning = (async () => {
      planner ??= plannerSession({ key, model: opts.planner, effort: opts.effort, rules: await game.guide(), you: view.you, goal, fetchImpl });
      const next = await planner.plan(`Review reason: ${reason}\nYour previous plan: ${JSON.stringify(plan && { objective: plan.objective, targets: plan.targets, waypoint: plan.waypoint })}\nRecent actions and results: ${JSON.stringify(recent.slice(-10))}\nActions currently available to the chooser: ${JSON.stringify(menu.map(o => o.description))}\n\nCurrent observation:\n${await plannerObservation()}`);
      plan = next; plans++;
      console.log(`[${view.tick}] PLAN (${reason}): ${next.objective} · targets ${JSON.stringify(next.targets)}${next.waypoint ? ` · waypoint ${next.waypoint.x},${next.waypoint.y}` : ""}`);
      await journal({ tick: view.tick, plan: next, reason });
      if (next.message) {
        const sent = await api("POST", "/chat", { text: next.message.text, ...(next.message.to && next.message.to !== "all" ? { to: next.message.to } : {}) }).then(() => "sent", e => `failed: ${e.message}`);
        recent.push({ action: `message to ${next.message.to ?? "all"}: ${next.message.text}`, result: sent });
      }
      for (const [kind, code] of Object.entries(next.scripts)) {
        // Installing compiles the script first; a script that does not compile is rejected with the reason.
        const result = await api("PUT", `/scripts/${kind}`, { code, lang: "js" }).then(() => "installed", e => `rejected: ${e.message.slice(0, 200)}`);
        recent.push({ action: `planner's ${kind} script`, result });
      }
    })().catch(e => { console.error(`castellan jev: plan failed: ${e.message}`); lastPlanAt = Date.now() - REPLAN_MS + 3000; })
      .finally(() => { planning = null; });
  };

  try {
    while (!stopped) {
      const started = Date.now();
      try {
        const view = await api("GET", `/state?since=${chooserSince}`);
        chooserSince = view.tick;
        if (seatOver({ status: view.status, alive: view.players.find(p => p.id === view.you)?.alive })) { finished = true; break; }
        if (view.status !== "running") { await sleep(1000, undefined, { signal: abort.signal }); continue; }
        const menu = candidates(view, plan, failed);
        const reason = !plan ? "no plan yet" : !Object.keys(needs(view, plan)).length ? "plan targets met" : rejections >= 3 ? "three rejected actions in a row"
          : !menu.length ? "no useful action available" : Date.now() - lastPlanAt > REPLAN_MS ? "periodic review" : null;
        if (reason && !planning && Date.now() - lastPlanAt > 3000) { replan(view, reason, menu); rejections = 0; }
        // Only the first plan is waited for; later plans arrive while the chooser keeps acting.
        if (!plan) { await planning; continue; }
        if (!menu.length) { await sleep(1000, undefined, { signal: abort.signal }); continue; }
        await reportActivity("deciding", { env, fetchImpl });
        const pick = await choose(summary(view, plan, recent), menu);
        jevCost += pick.cost; decisions++;
        const res = await api("POST", "/act", { orders: pick.selected.orders });
        const rejected = (res.results ?? []).find(r => !r.ok);
        if (rejected) { failed.set(pick.selected.key, Date.now() + FAILED_MS); rejections++; } else rejections = 0;
        // A move needs time to show its effect; an unreachable point would otherwise be re-sent every decision.
        if (/^(scout|waypoint)/.test(pick.selected.key)) failed.set(pick.selected.key, Date.now() + FAILED_MS);
        recent.push({ action: pick.selected.description, result: rejected ? `rejected: ${rejected.reason}` : "ok" });
        if (recent.length > 20) recent.shift();
        await journal({ tick: view.tick, key: pick.selected.key, action: pick.selected.description, confidence: pick.confidence, options: menu.length, jevMs: pick.ms, results: res.results });
        console.log(`[${view.tick}] ${pick.selected.description} · ${menu.length} options · ${pick.ms}ms${rejected ? ` · rejected: ${rejected.reason}` : ""}`);
        failures = 0;
        await reportActivity("between_decisions", { env, fetchImpl });
        await sleep(Math.max(0, opts.intervalMs - (Date.now() - started)), undefined, { signal: abort.signal });
      } catch (error) {
        if (stopped) break;
        failures++;
        const ms = Math.min(30_000, 1000 * failures);
        console.error(`castellan jev: ${/** @type {Error} */ (error).message}; retry in ${ms / 1000}s`);
        await reportActivity("connector_retry", { env, fetchImpl, retryAt: new Date(Date.now() + ms).toISOString() });
        await sleep(ms, undefined, { signal: abort.signal }).catch(() => {});
      }
    }
    return finished ? 0 : 1;
  } finally {
    stop();
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    console.error(`castellan jev usage: ${JSON.stringify({ decisions, plans, jevUsd: +jevCost.toFixed(4), plannerUsd: +(planner?.cost ?? 0).toFixed(4) })}`);
    await reportActivity("stopped", { env, fetchImpl });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) play().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
