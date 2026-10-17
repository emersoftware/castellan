import type { EntityView, GameEvent, PlayerView } from "./protocol";
import { NEUTRAL_OWNER } from "./protocol";
import { playerResult } from "./outcome";

/** How a kind's script reads to its player: `custom` once uploaded, else `default`. */
export const scriptOrigin = (script: { custom: boolean }) => (script.custom ? "custom" : "default");

/** How the neutral owner reads wherever an owner is named. */
export const NEUTRAL_OWNER_NAME = "scenario";

/**
 * Compact text form of a player view, for LLM connectors. It carries the same
 * information as the JSON with a fraction of the tokens.
 */
export function viewToText(v: PlayerView): string {
  const lines: string[] = [];
  const secs = (ms: number) => (ms / 1000).toFixed(1);
  const left = v.status === "finished" ? "" : ` · ${secs(Math.max(0, v.matchMs - v.timeMs))}s left`;
  lines.push(`tick ${v.tick} · ${secs(v.timeMs)}s/${secs(v.matchMs)}s${left} · ${v.status} · you are ${v.you}`);
  if (v.series) lines.push(`series ${v.series.id} · game ${v.series.gameNumber}/3 · ${v.series.status} · wins ${JSON.stringify(v.series.score)}${v.series.losses ? ` · losses ${JSON.stringify(v.series.losses)}` : ""} · previous games ${v.series.previousGames.join(", ") || "none"} (use history)`);
  const myTeam = v.players.find((p) => p.id === v.you)?.team;
  for (const p of v.players) {
    const tag = p.id === v.you ? "YOU  " : p.team === myTeam ? "ALLY " : "ENEMY";
    lines.push(`${tag} ${p.id}${p.name === p.id ? "" : ` ${p.name}`}: mineral ${p.mineral ?? "hidden"} · pop ${p.pop ?? "hidden"}/${p.popCap}${p.queuedPop ? ` (+${p.queuedPop} queued)` : ""} · score ${p.score ?? "hidden"} · kills ${p.kills ?? "hidden"}${p.alive ? "" : " · OUT"}`);
    if (p.upgrades) lines.push(`  upgrades: ${Object.entries(p.upgrades).map(([id, level]) => `${id} L${level}`).join(", ") || "none"}`);
    if (p.research) lines.push(`  researching ${p.research.upgrade} L${p.research.level}: ${secs(Math.max(0, p.research.completesAtMs - v.timeMs))}s remaining`);
    if (p.scriptRuntime) lines.push(`  SCRIPTS STOPPED at tick ${p.scriptRuntime.tick}: ${p.scriptRuntime.message}`);
  }
  if (v.outcome) {
    const winners = v.outcome.winners ?? (v.outcome.winner ? [v.outcome.winner] : []);
    lines.push(`OUTCOME result=${playerResult(v.outcome, v.you)} winner=${winners.length ? winners.join("+") : "none"}${v.outcome.allDefeated ? " · all defeated" : ""} reason=${v.outcome.reason}`);
  }
  // Put failures ahead of the map: a stopped script must not look like a
  // deliberate hold or an economic decision. Errors are historical, not proof
  // that a script still fails this tick.
  const errors = Object.entries(v.scripts).filter(([, s]) => s.errors.length);
  if (errors.length) lines.push("", "script errors (latest recorded):",
    ...errors.map(([kind, s]) => `  ${kind}: ${s.errors.at(-1)}`));
  // The same idle count for every mobile kind, so no unit type is singled out.
  const mobile = ["worker", "knight", "archer"].map(kind => [kind, v.mine.filter(e => e.kind === kind && !e.ruin)] as const).filter(([, units]) => units.length);
  if (v.status === "running" && mobile.length) {
    const idle = mobile.map(([kind, units]) => {
      const holding = units.filter(e => e.doing === "hold" && !e.order && !e.construction);
      return `${kind}s ${holding.length}/${units.length}${holding.length ? ` (${holding.map(e => e.id).join(", ")})` : ""}`;
    });
    const visible = v.deposits.reduce((sum, d) => sum + d.amount, 0);
    const remembered = v.lastSeen.reduce((sum, d) => sum + (d.kind === "deposit" ? d.amount : 0), 0);
    const tiles = v.visibility.join("");
    const unexplored = [...tiles].filter(tile => tile === "0").length;
    lines.push("", `idle now (hold, no order): ${idle.join(" · ")}`,
      `economy: resources in sight ${visible} · last seen outside vision ${remembered} (may have changed)${tiles.length ? ` · unexplored ${Math.round(unexplored / tiles.length * 100)}%` : ""}`);
  }
  if (v.underAttack?.length) {
    lines.push("", "under attack since your last view:");
    for (const a of v.underAttack.slice(0, 12)) {
      const by = [...a.attackers.map((x) => `${x.id} ${x.kind} ${x.owner}`), ...(a.unseenAttackers ? [`${a.unseenAttackers} unseen`] : [])].join(", ");
      lines.push(`  ${a.id} ${a.kind} (${a.x},${a.y}) -${a.damage} hp by ${by}`);
    }
    if (v.underAttack.length > 12) lines.push(`  … ${v.underAttack.length - 12} more`);
  }
  if (v.combat?.encounters.length || v.combat?.truncated) {
    lines.push("", `combat since tick ${v.combat.sinceTick}${v.combat.truncated ? " (older history expired; two minutes retained)" : ""}:`);
    for (const b of v.combat.encounters) lines.push(`  area (${b.x}..${b.x + 5},${b.y}..${b.y + 5}) ticks ${b.fromTick}..${b.toTick}: damage taken ${JSON.stringify(b.damage)}; losses ${b.losses.map(l => `${l.owner} ${l.kind} ${l.id}`).join(", ") || "none observed"}`);
  }
  if (v.availableActions) {
    const available = (blocked: string[]) => blocked.length ? `blocked: ${blocked.join("; ")}` : "available now";
    lines.push("", "action costs and current restrictions (may change before application):");
    for (const a of v.availableActions.train) lines.push(`  train ${a.kind} at ${a.building}: ${a.cost}, queue ${a.queue}/${a.queueLimit}, ${available(a.blockedBy)}${a.exitBlocked ? "; exit blocked (paid queued units wait)" : ""}`);
    lines.push("  build (site and path still need checking; charged on completion): " + v.availableActions.build.map(a => `${a.kind} ${a.cost}: ${available(a.blockedBy)}`).join(" · "));
    lines.push("  research: " + v.availableActions.research.map(a => `${a.upgrade} L${a.level} ${a.cost ?? "—"}: ${available(a.blockedBy)}`).join(" · "));
  }
  if (v.chat) {
    lines.push("", v.chat.enabled ? "chat (last 5 visible messages):" : "chat: off");
    if (v.chat.enabled) {
      if (!v.chat.messages.length) lines.push("  no messages yet");
      for (const m of v.chat.messages) {
        lines.push(`  [${m.tick}] ${m.from}${m.name === m.from ? "" : ` ${JSON.stringify(m.name)}`}${m.from === v.you ? " (you)" : ""}${m.channel === "private" ? ` [private to ${m.to}]` : m.channel === "team" ? " [team]" : " [all]"}: ${JSON.stringify(m.text)}`);
      }
      lines.push("  Use chat without text to read the full visible history.");
    }
  }
  lines.push("fog: ? unexplored · : explored ground outside vision · enemy units on the map are currently visible; historical unit sightings are listed in last seen. Buildings and deposits outside vision are drawn as last seen.");
  lines.push("", "map (x→, y↓; the x ruler is tens over units: column 24 = '2' over '4'):");
  const w = v.grid[0]?.length ?? 0;
  const ruler = Array.from({ length: w }, (_, x) => (x % 10 === 0 ? String(x / 10) : " ")).join("");
  const ruler2 = Array.from({ length: w }, (_, x) => String(x % 10)).join("");
  lines.push(`   ${ruler}`, `   ${ruler2}`);
  v.grid.forEach((row, y) => lines.push(`${String(y).padStart(2)} ${row} ${y}`));
  lines.push(`   ${ruler2}`, `   ${ruler}`);
  lines.push("", "mine:", ...v.mine.map(entityLine));
  if (v.allies.length) lines.push("allies (grid + unit, = building):", ...v.allies.map((e) => `${entityLine(e)} · owner ${e.owner}`));
  lines.push("enemy:", ...v.enemy.filter(e => e.owner !== NEUTRAL_OWNER).map((e) => `${entityLine(e)} · owner ${e.owner}`));
  const neutral = v.enemy.filter(e => e.owner === NEUTRAL_OWNER);
  if (neutral.length) lines.push("neutral walls (scenario, not a player; attackable):", ...neutral.map(entityLine));
  if (v.lastSeen.length) {
    lines.push("last seen (outside your vision now; may have changed):");
    for (const l of v.lastSeen.slice(0, 20)) {
      const ago = `seen ${secs(Math.max(0, v.timeMs - l.seenMs))}s ago`;
      lines.push(l.kind === "deposit" ? `  ${l.id} deposit (${l.x},${l.y}) = ${l.amount} · ${ago}`
        : `  ${l.id} ${l.kind} (${l.x},${l.y}) hp ${l.hp}/${l.maxHp}${l.ruin ? " · RUIN" : ""} · owner ${l.owner} · ${ago}${l.positionCleared ? " · former position now empty" : ""}`);
    }
    if (v.lastSeen.length > 20) lines.push(`  … ${v.lastSeen.length - 20} more`);
  }
  lines.push("deposits: " + v.deposits.map((d) => `${d.id}(${d.x},${d.y})=${d.amount}`).join(" "));
  if (v.projectiles) lines.push("projectiles (visible; velocity in tiles/s): " + (v.projectiles.map((p) =>
    `${p.id} owner ${p.owner} (${p.x.toFixed(2)},${p.y.toFixed(2)}) velocity (${p.vx.toFixed(2)},${p.vy.toFixed(2)}) destination (${p.endX},${p.endY})`).join("; ") || "none"));
  const scripts = Object.entries(v.scripts).map(([k, s]) => `${k}:${scriptOrigin(s)}${s.errors.length ? ` ERR ${s.errors.at(-1)}` : ""}`);
  lines.push("scripts: " + scripts.join(" · "));
  // Unloads are already visible as mineral; listing them would bury the events that matter.
  // Chat has its own history above, so it cannot be buried by the events cap.
  const ev = v.events.filter((e) => e.type !== "attack" && e.type !== "unload" && !(v.chat && e.type === "chat"));
  if (ev.length) lines.push("events:", ...ev.slice(-30).map(eventLine));
  return lines.join("\n");
}

function entityLine(e: EntityView): string {
  const extra = [
    e.vital ? "VITAL" : "",
    e.ruin ? `RUIN (${e.owner === NEUTRAL_OWNER ? NEUTRAL_OWNER_NAME : "owner eliminated"}: inert, blocks, can be destroyed)` : "",
    e.training ? `training [${e.training.map((job) => `${job.kind}${job.completesAtMs !== undefined ? ` completes at ${(job.completesAtMs / 1000).toFixed(1)}s (waits if exits blocked)` : " queued"}`).join(", ")}]` : "",
    e.construction ? `building ${e.construction.kind} (${e.construction.x},${e.construction.y}), completes at ${(e.construction.completesAtMs / 1000).toFixed(1)}s` : "",
    e.stats ? `atk ${e.stats.atk} def ${e.stats.def} range ${e.stats.range} attack ${e.stats.attackMs}ms move ${e.stats.moveMs}ms` : "",
    e.order ? `order ${e.order}${e.orderSuspended ? " (suspended by script)" : ""}` : "",
    e.orderProgress ? orderProgressText(e.orderProgress) : "",
    e.doing ? `doing ${e.doing}` : "",
    e.actionResult ? `result [${e.actionResult.tick}] ${e.actionResult.source}: ${e.actionResult.status}${e.actionResult.effect ? ` ${e.actionResult.effect}` : ""}${e.actionResult.reason ? ` (${e.actionResult.reason})` : ""}` : "",
    !e.doing && e.heading ? `heading ${e.heading}` : "",
    e.carrying ? `carry ${e.carrying}` : "",
  ].filter(Boolean).join(" · ");
  return `  ${e.id} ${e.kind} (${e.x},${e.y}) hp ${e.hp}/${e.maxHp}${extra ? " · " + extra : ""}`;
}

function orderProgressText(p: NonNullable<EntityView["orderProgress"]>): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const m = p.movement;
  const actions = Object.entries(p.scriptActions).map(([action, count]) => `${action}=${count}`).join(",");
  return [
    `order history ${seconds(p.ageMs)}`,
    p.suspensions ? `suspended ${seconds(p.currentSuspensionMs)} now/${seconds(p.suspendedMs)} total (${p.suspensions} ${p.suspensions === 1 ? "pause" : "pauses"})` : "",
    `moved ${m.steps} steps, net ${m.netTiles} tiles${m.towardDestination !== undefined ? `, toward destination ${m.towardDestination >= 0 ? "+" : ""}${m.towardDestination}` : ""}`,
    m.stationaryMs ? `stationary ${seconds(m.stationaryMs)}` : "",
    actions ? `script actions ${actions}` : "",
    p.blockedMs ? `blocked ${seconds(p.blockedMs)}` : "",
  ].filter(Boolean).join("; ");
}

export function eventLine(e: GameEvent): string {
  if (e.type === "chat") return `  [${e.tick}] ${e.owner}${e.channel === "private" ? ` [private to ${e.to}]` : e.channel === "team" ? " [team]" : ""} says: ${JSON.stringify(e.text)}`;
  const { tick, type, ...rest } = e;
  return `  [${tick}] ${type} ${Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`;
}
