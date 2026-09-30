import type { EntityView, GameEvent, PlayerView } from "./protocol";

/**
 * Compact text form of a player view, for LLM connectors. It carries the same
 * information as the JSON with a fraction of the tokens.
 */
export function viewToText(v: PlayerView): string {
  const lines: string[] = [];
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  const left = v.status === "finished" ? "" : ` · ${secs(Math.max(0, v.matchMs - v.timeMs))}s left${v.timeoutOutcome === "draw" ? ", then draw" : v.timeoutOutcome === "score" ? ", then highest score wins" : v.timeoutOutcome === "survivorScore" ? ", then the surviving player with the highest score wins" : ""}`;
  lines.push(`tick ${v.tick} · ${secs(v.timeMs)}s/${secs(v.matchMs)}s${left} · ${v.status} · you are ${v.you}`);
  if (v.series) lines.push(`series ${v.series.id} · game ${v.series.gameNumber}/3 · ${v.series.status} · wins ${JSON.stringify(v.series.score)} · previous games ${v.series.previousGames.join(", ") || "none"} (use history)`);
  const myTeam = v.players.find((p) => p.id === v.you)?.team;
  for (const p of v.players) {
    const tag = p.id === v.you ? "YOU  " : p.team === myTeam ? "ALLY " : "ENEMY";
    lines.push(`${tag} ${p.id} ${p.name}: capital ${p.capital ?? "hidden"} · pop ${p.pop ?? "hidden"}/${p.popCap}${p.queuedPop ? ` (+${p.queuedPop} queued)` : ""} · score ${p.score ?? "hidden"} · kills ${p.kills ?? "hidden"}${p.alive ? "" : " · OUT"}`);
    if (p.upgrades) lines.push(`  upgrades: ${Object.entries(p.upgrades).map(([id, level]) => `${id} L${level}`).join(", ") || "none"}`);
    if (p.research) lines.push(`  researching ${p.research.upgrade} L${p.research.level}: ${secs(Math.max(0, p.research.completesAtMs - v.timeMs))}s remaining`);
  }
  if (v.outcome) {
    const winners = v.outcome.winners ?? (v.outcome.winner ? [v.outcome.winner] : []);
    lines.push(`OUTCOME winner=${winners.length ? winners.join("+") : "draw"} reason=${v.outcome.reason}`);
  }
  if (v.underAttack?.length) {
    lines.push("", "under attack since your last view:");
    for (const a of v.underAttack.slice(0, 12)) {
      const by = [...a.attackers.map((x) => `${x.id} ${x.kind} ${x.owner}`), ...(a.unseenAttackers ? [`${a.unseenAttackers} unseen`] : [])].join(", ");
      lines.push(`  ${a.id} ${a.kind} (${a.x},${a.y}) -${a.damage} hp by ${by}`);
    }
    if (v.underAttack.length > 12) lines.push(`  … ${v.underAttack.length - 12} more`);
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
  if (v.visibility) lines.push("fog: ? unexplored · : explored ground outside vision · enemy units are shown only while in vision; enemy buildings and deposits outside vision are drawn as last seen (see last seen)");
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
  if (v.lastSeen?.length) {
    lines.push("last seen (outside your vision now; may have changed):");
    for (const l of v.lastSeen.slice(0, 20)) {
      const ago = `seen ${secs(Math.max(0, v.timeMs - l.seenMs))}s ago`;
      lines.push(l.kind === "deposit" && "amount" in l ? `  ${l.id} deposit (${l.x},${l.y}) = ${l.amount} · ${ago}`
        : "owner" in l ? `  ${l.id} ${l.kind} (${l.x},${l.y}) hp ${l.hp}/${l.maxHp}${l.ruin ? " · RUIN" : ""} · owner ${l.owner} · ${ago}` : "");
    }
    if (v.lastSeen.length > 20) lines.push(`  … ${v.lastSeen.length - 20} more`);
  }
  lines.push("deposits: " + v.deposits.map((d) => `${d.id}(${d.x},${d.y})=${d.amount}`).join(" "));
  if (v.projectiles) lines.push("projectiles (visible; velocity in tiles/s): " + (v.projectiles.map((p) =>
    `${p.id} owner ${p.owner} (${p.x.toFixed(2)},${p.y.toFixed(2)}) velocity (${p.vx.toFixed(2)},${p.vy.toFixed(2)}) destination (${p.endX},${p.endY})`).join("; ") || "none"));
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
    e.vital ? "VITAL" : "",
    e.ruin ? "RUIN (owner eliminated: inert, blocks, can be destroyed)" : "",
    e.training ? `training [${e.training.map((job) => `${job.kind}${job.completesAtMs !== undefined ? ` completes at ${(job.completesAtMs / 1000).toFixed(1)}s (waits if exits blocked)` : " queued"}`).join(", ")}]` : "",
    e.construction ? `building ${e.construction.kind} (${e.construction.x},${e.construction.y}), completes at ${(e.construction.completesAtMs / 1000).toFixed(1)}s` : "",
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
