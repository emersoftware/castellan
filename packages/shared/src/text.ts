import type { EntityView, GameEvent, PlayerView } from "./protocol";

/**
 * Compact text form of a player view, for LLM connectors. It carries the same
 * information as the JSON with a fraction of the tokens.
 */
export function viewToText(v: PlayerView): string {
  const lines: string[] = [];
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  lines.push(`tick ${v.tick} · ${secs(v.timeMs)}s/${secs(v.matchMs)}s · ${v.status} · you are ${v.you}`);
  if (v.series) lines.push(`series ${v.series.id} · game ${v.series.gameNumber}/3 · ${v.series.status} · wins ${JSON.stringify(v.series.score)} · previous games ${v.series.previousGames.join(", ") || "none"} (use history)`);
  const myTeam = v.players.find((p) => p.id === v.you)?.team;
  for (const p of v.players) {
    const tag = p.id === v.you ? "YOU  " : p.team === myTeam ? "ALLY " : "ENEMY";
    lines.push(`${tag} ${p.id} ${p.name}: capital ${p.capital} · pop ${p.pop}/${p.popCap} · score ${p.score} · kills ${p.kills}${p.alive ? "" : " · OUT"}`);
    if (p.upgrades) lines.push(`  upgrades: ${Object.entries(p.upgrades).map(([id, level]) => `${id} L${level}`).join(", ") || "none"}`);
    if (p.research) lines.push(`  researching ${p.research.upgrade} L${p.research.level}: ${secs(Math.max(0, p.research.completesAtMs - v.timeMs))}s remaining`);
  }
  if (v.outcome) {
    const winners = v.outcome.winners ?? (v.outcome.winner ? [v.outcome.winner] : []);
    lines.push(`OUTCOME winner=${winners.length ? winners.join("+") : "draw"} reason=${v.outcome.reason}`);
  }
  if (v.chat) {
    lines.push("", v.chat.enabled ? "chat (last 5 visible messages):" : "chat: off");
    if (v.chat.enabled) {
      if (!v.chat.messages.length) lines.push("  no messages yet");
      for (const m of v.chat.messages) {
        lines.push(`  [${m.tick}] ${m.from} ${JSON.stringify(m.name)}${m.from === v.you ? " (you)" : ""}${m.channel === "private" ? ` [private to ${m.to}]` : m.channel === "team" ? " [team]" : " [all]"}: ${JSON.stringify(m.text)}`);
      }
      lines.push("  Use chat without text to read the full visible history.");
    }
  }
  lines.push("", "map (x→, y↓; the x ruler is tens over units: column 24 = '2' over '4'):");
  const w = v.grid[0]?.length ?? 0;
  const ruler = Array.from({ length: w }, (_, x) => (x % 10 === 0 ? String(x / 10) : " ")).join("");
  const ruler2 = Array.from({ length: w }, (_, x) => String(x % 10)).join("");
  lines.push(`   ${ruler}`, `   ${ruler2}`);
  v.grid.forEach((row, y) => lines.push(`${String(y).padStart(2)} ${row} ${y}`));
  lines.push(`   ${ruler2}`, `   ${ruler}`);
  lines.push("", "mine:", ...v.mine.map(entityLine));
  if (v.allies.length) lines.push("allies (grid + unit, = building):", ...v.allies.map((e) => `${entityLine(e)} · owner ${e.owner}`));
  lines.push("enemy:", ...v.enemy.map((e) => `${entityLine(e)} · owner ${e.owner}`));
  lines.push("deposits: " + v.deposits.map((d) => `${d.id}(${d.x},${d.y})=${d.amount}`).join(" "));
  const scripts = Object.entries(v.scripts).map(([k, s]) => `${k}:${s.custom ? "custom" : "default"}${s.errors.length ? ` ERR ${s.errors.at(-1)}` : ""}`);
  lines.push("scripts: " + scripts.join(" · "));
  // Unloads are already visible as capital; listing them would bury the events that matter.
  // Chat has its own history above, so it cannot be buried by the events cap.
  const ev = v.events.filter((e) => e.type !== "attack" && e.type !== "unload" && !(v.chat && e.type === "chat"));
  if (ev.length) lines.push("events:", ...ev.slice(-30).map(eventLine));
  return lines.join("\n");
}

function entityLine(e: EntityView): string {
  const extra = [
    e.stats ? `atk ${e.stats.atk} def ${e.stats.def} range ${e.stats.range} attack ${e.stats.attackMs}ms move ${e.stats.moveMs}ms` : "",
    e.order ? `order ${e.order}` : "",
    e.doing ? `doing ${e.doing}` : "",
    !e.doing && e.heading ? `heading ${e.heading}` : "",
    e.carrying ? `carry ${e.carrying}` : "",
  ].filter(Boolean).join(" · ");
  return `  ${e.id} ${e.kind} (${e.x},${e.y}) hp ${e.hp}/${e.maxHp}${extra ? " · " + extra : ""}`;
}

export function eventLine(e: GameEvent): string {
  if (e.type === "chat") return `  [${e.tick}] ${e.owner}${e.channel === "private" ? ` [private to ${e.to}]` : e.channel === "team" ? " [team]" : ""} says: ${JSON.stringify(e.text)}`;
  const { tick, type, ...rest } = e;
  return `  [${tick}] ${type} ${Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`;
}
