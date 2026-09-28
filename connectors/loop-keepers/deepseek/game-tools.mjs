// A harness plugin, not a replacement agent loop. Deny every non-game tool
// at execution as well as filtering the model-visible catalog.
export const name = "aoa-game-tools";
export const inject = ["tools"];
export const TOOLS = ["act", "chat", "history", "rules", "script", "state", "wait"].map((t) => `mcp__aoa__${t}`);
export function apply(ctx) {
  ctx.tools.guard((call) => TOOLS.includes(call.name) ? undefined : "Only AoA game tools are available to this player.");
  ctx.on("agent/created", ({ agent }) => {
    agent.ctx.tools.restrict({ allow: TOOLS });
    const names = agent.ctx.tools.schemas().map((t) => t.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([...TOOLS].sort())) throw new Error("AoA tool catalog mismatch; refusing to start the player");
  });
}
