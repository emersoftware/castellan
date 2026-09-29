/** Writes a few bot-vs-bot replays so the web client has something to show. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { BOTS, simulate } from "@aoa/sim";
import { v9 } from "@aoa/shared";
import { saveReplay } from "./app";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const dir = resolve(process.env.REPLAY_DIR ?? resolve(root, "replays"));
const pairs: [string, string][] = [["eco", "rush"], ["turtle", "eco"], ["rush", "turtle"], ["eco", "eco"]];
for (const [a, b] of pairs) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const r = await simulate({ bot: BOTS[a](), latencyMs: 3000 }, { bot: BOTS[b](), latencyMs: 3000 }, { seed });
  const id = randomBytes(4).toString("hex");
  await saveReplay(dir, {
    format: 1, id, createdAt: new Date().toISOString(), ruleset: v9, seed, tickRate: 10,
    players: [{ id: "p1", name: `bot:${a}` }, { id: "p2", name: `bot:${b}` }],
    orders: r.orders, hashes: r.hashes, finalTick: r.ticks, outcome: r.outcome,
  });
  console.log(`replay ${id}: ${a} vs ${b} → ${r.outcome.winner ?? "draw"} (${r.outcome.reason}, ${(r.ticks / 600).toFixed(1)} min)`);
}
