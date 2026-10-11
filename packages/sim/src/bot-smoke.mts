/** Current-rules reference-bot audit; no model calls. JSONL output, one independent match per row. */
import { createMatch } from "@aoa/engine";
import { MAPS, rules } from "@aoa/shared";
import { BOTS } from "./bots";

const seconds = Number(process.argv[2] ?? 90);
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Pass a positive duration in seconds");
const names = process.argv[3]?.split(",") ?? Object.keys(BOTS);
const maps = process.argv[4]?.split(",") ?? ["open", "fortress"];
if (names.some((name) => !BOTS[name]) || maps.some((map) => !MAPS[map])) throw new Error("Unknown bot or map name");
for (const map of maps) for (const side of [0, 1]) for (const name of names) {
  const r = { ...rules, map: MAPS[map] };
  const m = await createMatch({ ruleset: r, seed: 7, tickRate: 10,
    players: [{ id: "p1", name, side }, { id: "p2", name: "no decisions", side: 1 - side }] });
  try {
    const bot = BOTS[name](r), military = new Set<string>(), reasons: Record<string, number> = {}, produced: Record<string, number> = {};
    const owners = new Map(m.spectate().entities.map((e) => [e.id, e.owner]));
    let rejects = 0, attacks = 0, scriptErrors = 0;
    for (let t = 0; t < seconds * m.tickRate && !m.outcome; t++) {
      const input = t % 30 === 0 ? bot(m.view("p1", t)).map((order) => ({ player: "p1", order })) : [];
      const result = m.step(input);
      for (const res of result.results) if (!res.ok) { rejects++; reasons[res.reason] = (reasons[res.reason] ?? 0) + 1; }
      for (const e of result.events) {
        if (e.type === "spawn") {
          owners.set(e.id, e.owner);
          if (e.owner === "p1" && ["knight", "archer", "tower"].includes(e.kind)) {
            military.add(e.id); produced[e.kind] = (produced[e.kind] ?? 0) + 1;
          }
        }
        if (e.type === "attack" && owners.get(e.from) === "p1") attacks++;
        if (e.type === "script_error" && e.owner === "p1") scriptErrors++;
      }
    }
    console.log(JSON.stringify({ version: r.version, map, side, bot: name, seconds: m.tick / m.tickRate,
      military: military.size, produced, attacks, rejects, scriptErrors, reasons, outcome: m.outcome }));
  } finally { m.dispose(); }
}
