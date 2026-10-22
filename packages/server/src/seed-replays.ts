/** Writes a few bot-vs-bot replays so the web client has something to show. */
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { BOTS } from "@castellan/bots";
import { simulate } from "@castellan/sim";
import { rules, outcomeText, type BotName } from "@castellan/shared";
import { localReplays } from "@castellan/shared/local-data";
import { ReplayArchive } from "./archive";

const archive = new ReplayArchive(resolve(localReplays()));
const pairs: [BotName, BotName][] = [["eco", "rush"], ["turtle", "eco"], ["rush", "turtle"], ["eco", "eco"]];
for (const [a, b] of pairs) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const r = await simulate({ bot: BOTS[a](), latencyMs: 3000 }, { bot: BOTS[b](), latencyMs: 3000 }, { seed });
  const id = randomBytes(4).toString("hex");
  await archive.save({
    format: 1, id, createdAt: new Date().toISOString(), ruleset: rules, seed, tickRate: 10,
    players: [{ id: "p1", name: `bot:${a}` }, { id: "p2", name: `bot:${b}` }],
    orders: r.orders, hashes: r.hashes, finalTick: r.ticks, outcome: r.outcome,
  });
  console.log(`replay ${id}: ${a} vs ${b} → ${outcomeText(r.outcome)} (${r.outcome.reason}, ${(r.ticks / 600).toFixed(1)} min)`);
}
