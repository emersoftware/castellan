// A harness plugin, not a replacement agent loop. Deny every non-game tool
// at execution as well as filtering the model-visible catalog.
import { GAME_TOOLS } from "@castellan/shared";

/** @public dsh discovers this plugin's name through its runtime loader. */
export const name = "castellan-game-tools";
/** @public dsh injects these services before invoking apply. */
export const inject = ["tools"];
const TOOLS = GAME_TOOLS.map((t) => `mcp__castellan__${t}`);
/** @public dsh invokes this plugin hook; there is no static application import. */
export function apply(ctx) {
  ctx.tools.guard((call) => TOOLS.includes(call.name) ? undefined : "Only Castellan game tools are available to this player.");
  ctx.on("agent/created", ({ agent }) => {
    agent.ctx.tools.restrict({ allow: TOOLS });
    const names = agent.ctx.tools.schemas().map((t) => t.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([...TOOLS].sort())) throw new Error("Castellan tool catalog mismatch; refusing to start the player");
  });
}
