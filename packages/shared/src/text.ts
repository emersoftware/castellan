import type { EntityView, GameEvent, PlayerView } from "./protocol";

/**
 * Compact text form of a player view, for LLM connectors. It carries the same
 * information as the JSON with a fraction of the tokens.
 */
export function viewToText(v: PlayerView): string {
  const lines: string[] = [];
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  lines.push(`tick ${v.tick} · ${secs(v.timeMs)}s/${secs(v.matchMs)}s · ${v.status} · you are ${v.you}`);
  for (const p of v.players) {
    lines.push(`${p.id === v.you ? "YOU  " : "ENEMY"} ${p.id} ${p.name}: capital ${p.capital} · pop ${p.pop}/${p.popCap} · score ${p.score} · kills ${p.kills}${p.alive ? "" : " · LOST"}`);
  }
  if (v.outcome) lines.push(`OUTCOME winner=${v.outcome.winner ?? "draw"} reason=${v.outcome.reason}`);
  lines.push("", "map (x→, y↓; the x ruler is tens over units: column 24 = '2' over '4'):");
  const w = v.grid[0]?.length ?? 0;
  const ruler = Array.from({ length: w }, (_, x) => (x % 10 === 0 ? String(x / 10) : " ")).join("");
  const ruler2 = Array.from({ length: w }, (_, x) => String(x % 10)).join("");
  lines.push(`   ${ruler}`, `   ${ruler2}`);
  v.grid.forEach((row, y) => lines.push(`${String(y).padStart(2)} ${row} ${y}`));
  lines.push(`   ${ruler2}`, `   ${ruler}`);
  lines.push("", "mine:", ...v.mine.map(entityLine), "enemy:", ...v.enemy.map(entityLine));
  lines.push("deposits: " + v.deposits.map((d) => `${d.id}(${d.x},${d.y})=${d.amount}`).join(" "));
  const scripts = Object.entries(v.scripts).map(([k, s]) => `${k}:${s.custom ? "custom" : "default"}${s.errors.length ? ` ERR ${s.errors.at(-1)}` : ""}`);
  lines.push("scripts: " + scripts.join(" · "));
  // Unloads are already visible as capital; listing them would bury the events that matter.
  const ev = v.events.filter((e) => e.type !== "attack" && e.type !== "unload");
  if (ev.length) lines.push("events:", ...ev.slice(-30).map(eventLine));
  return lines.join("\n");
}

function entityLine(e: EntityView): string {
  const extra = [
    e.order ? `order ${e.order}` : "",
    e.doing ? `doing ${e.doing}` : "",
    !e.doing && e.heading ? `heading ${e.heading}` : "",
    e.carrying ? `carry ${e.carrying}` : "",
  ].filter(Boolean).join(" · ");
  return `  ${e.id} ${e.kind} (${e.x},${e.y}) hp ${e.hp}/${e.maxHp}${extra ? " · " + extra : ""}`;
}

export function eventLine(e: GameEvent): string {
  if (e.type === "chat") return `  [${e.tick}] ${e.owner} says: ${JSON.stringify(e.text)}`;
  const { tick, type, ...rest } = e;
  return `  [${tick}] ${type} ${Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`;
}
