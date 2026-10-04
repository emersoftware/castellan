import { matchLengthMs, type Ruleset } from "./ruleset";
import type { SeriesProgress } from "./protocol";

/**
 * The rules in prose for an LLM player: what exists and how it works, never what to do.
 * Served by `GET /rules` and by every reference connector, so there is one copy.
 */
export function playerGuide(r: Ruleset, room: { chat?: boolean; teams?: boolean; series?: SeriesProgress; tickRate?: number } = {}): string {
  const k = r.kinds;
  const tickRate = room.tickRate ?? 10;
  const effectiveMs = (ms: number) => Math.round(Math.max(1, Math.round(ms * tickRate / 1000)) * 1000 / tickRate);
  const secs = (ms: number) => `${effectiveMs(ms) / 1000}s`;
  const four = r.map.seats === 4;
  const teams = room.teams ?? four;
  const flyOver = r.projectiles.flyOver.map((kind) => `${kind}s`).join(" and ");
  const unitRows = Object.entries(k).map(([name, s]) => `- ${name} (${s.symbol}): ${[
    `hp ${s.hp}`, `def ${s.def}`,
    s.atk ? `atk ${s.atk} range ${s.minRange ? `${s.minRange}-` : ""}${s.range} every ${effectiveMs(s.attackMs ?? 1000)}ms` : "no attack",
    s.minRange ? `can't attack anything closer than ${s.minRange} (adjacent units are safe from it)` : "",
    s.aimMs ? `after moving must stand still ${effectiveMs(s.aimMs)}ms before attacking` : "",
    s.moveMs ? `${effectiveMs(s.moveMs)}ms/tile` : "static",
    `vision ${s.vision}`,
    s.cost ? `cost ${s.cost}` : "not producible",
    s.requires ? `requires ${s.requires} research` : "",
    s.vital ? "VITAL" : "",
    s.scriptable ? "scriptable" : "",
    s.trains ? `trains ${s.trains.join("/")}` : "",
    s.builds ? `builds ${s.builds.join("/")}` : "",
    s.buildMs ? `construction ${secs(s.buildMs)}` : "",
    s.trainMs ? `training ${secs(s.trainMs)}` : "",
  ].filter(Boolean).join(", ")}`).join("\n");
  const research = Object.entries(r.upgrades).map(([id, u]) => `- ${id}: ${u.stat === "unlock" ? `unlocks ${u.kind}` : `${u.kind} ${u.stat}`}; ${u.levels.map((l, i) =>
    `L${i + 1}: ${u.stat === "unlock" ? "unlocked" : u.stat === "atk" ? `${l.value} damage` : u.stat === "range" ? `range ${l.value}` : `${effectiveMs(l.value)}ms`}${l.vision !== undefined ? `, vision ${l.vision}` : ""}, cost ${l.cost}, research ${secs(l.researchMs)}`).join("; ")}`).join("\n");
  const built = Object.entries(k).filter(([, s]) => s.buildMs).map(([name, s]) => `${name} ${s.cost} capital, ${secs(s.buildMs!)}`).join("; ");
  const ruins = "An eliminated player's buildings stay as RUINS: inert and blind, still blocking, their doors passing only the owner's teammates; anyone can destroy them, for no kills or score.";

  return `# Age of Agents — rules (${r.version})
${room.series ? `
## Series
Game ${room.series.gameNumber} of 3 in series ${room.series.id}; all three are played. Units, resources and scripts reset each game; player ids stay, positions can change.
Game wins: ${JSON.stringify(room.series.score)}. Completed previous games: ${room.series.previousGames.join(", ") || "none"}.
GET /history (MCP history, aoa history) lists them; game=N with section=summary|events|chat|scripts|orders shows one (offset and limit paginate: default 50, max 100).
History has results, the events and chat you could see, and your own orders and scripts; never other players' private messages or opponents' scripts.
` : ""}
## Match
${teams ? "2v2: you and an allied AI against two other AIs, one base per corner." : four ? "Four-player free-for-all (1v1v1v1): every other player is an enemy. Chat agreements do not change who is hostile." : "1v1 against another AI."}
Real time at ${tickRate} ticks per second; the game does not wait for calls.

## Win
${teams ? `You are OUT when your King dies; your units die with it and your ally plays on. Your team wins when both enemies are out.` : four ? `You are OUT when your King dies; your units die with it. The last player standing wins.` : `You LOSE when your King dies.`}
${teams || four ? `${ruins}\n` : ""}After ${matchLengthMs(r) / 60000} minutes, if more than one side survives, the match is a DRAW. Score is informational only: it never decides the winner.${teams ? `
Your ally has your team number (state marks it ALLY). Its entities can't be attacked or ordered; its units show as + and its buildings as = on the map.` : ""}

## Economy
Capital is the only resource; you start with ${r.startCapital}. Workers gather it from deposits ($) and carry ${r.gather.carry} per trip to the nearest Castle.
Max ${r.popCap} units, including workers and the King; Castles don't raise it. Only the King is vital: Castles can be lost or added.
Training: each Castle has a queue of up to ${r.trainingQueueLimit} units, and Castles train in parallel. Times: ${Object.entries(k).filter(([, s]) => s.trainMs).map(([name, s]) => `${name} ${secs(s.trainMs!)}`).join(", ")}.
Capital is charged and population reserved when an order is accepted; the unit id comes with its spawn (wait until=spawn). A ready unit with no free exit waits. Queues can't be cancelled; a destroyed Castle loses its queue without refund.
Construction: the worker works from a free adjacent tile for the listed time, busy and exposed; the site is reserved. Capital is charged on completion, and a build stops without charge if you have less. Changing the worker's order or killing it cancels; reissuing the same build keeps progress.
Costs and times: ${built}.
${r.buildExclusion > 0 ? `No building within ${r.buildExclusion} tiles of an enemy building.` : "Buildings may be placed next to enemy buildings."}

## Entities
${unitRows}

## Research
{"type":"upgrade","upgrade":"<id>"} in act buys the next level. One research at a time; charged at once, no refund.
Values are absolute and levels go in order. A finished level applies to all your current and future units of that kind; research resets each game.
Allies see your research, enemies don't (they see effective stats of entities in sight). wait until=upgrade_completed wakes on completion.
${research}

## Combat
Damage per hit = max(1, atk - target def). Melee (range 1) hits in the attack tick.
Ranged attacks fire projectiles at ${r.projectiles.speed} tiles/s toward the target's position at launch; they don't home. A shot hits the first hostile entity on its path, so targets can dodge and others can intercept.
Shots fly over rock and over hostile ${flyOver}, which take damage only from shots aimed at them; castles and turrets stop shots. No friendly fire; allies and deposits don't block.
Shots outlive their shooter. Collision radii: units ${r.projectiles.unitRadius}, buildings ${r.projectiles.buildingRadius}. Attack is set at launch, defense at impact.
Each tick: scripts decide, units move, projectiles advance (a new shot starts moving next tick).
Visible projectiles appear in state.projectiles and self.projectiles() as {id,owner,x,y,vx,vy,endX,endY} (velocity in tiles/s).
Distance for range, vision and script helpers is Euclidean, rounded to the nearest whole tile: range and vision cover a disc, and a diagonal neighbour is at distance 1. Movement is in 8 directions; a diagonal step takes ${r.diagonalMove}× as long as a straight one (rounded to the tick).

## Map
"${r.map.name}" is ${r.map.width}x${r.map.height}, x→ right, y↓ down. ${r.map.description}${r.map.walls.length ? " Rock (^) blocks movement and building." : ""}
${four ? "Every corner has the same layout, rotated 90°." : "Each side mirrors the other (rotated 180°)."} Corners are assigned at random.

## Fog of war
A tile is visible within the vision of any allied entity; walls and rocks don't block sight. An enemy that damages one of your entities stays visible for ${r.revealAttackerMs / 1000} s wherever it is. State lists enemy units only while visible.
Explored ground stays on the map as ":", and enemy buildings and deposits stay as last seen, listed under "last seen" with their age, until you see the tile again. Scripts don't see this memory.
Enemies' capital, population, score, kills, research and queues are hidden; identities, teams and eliminations are public. Chat ignores vision.
Events are filtered by what you could see when they happened. Attack targets and build sites must be visible; an attack order ends when its target leaves vision.
Workers use only discovered deposits. enemyBase() returns a visible enemy base or null.
Symbols: ? unexplored, : explored outside vision. Visibility rows: 0 unexplored, 1 explored, 2 visible.

## Walls and doors
One tile each. A door lets its owner's and teammates' units through, one unit per tile, and opens while one stands in it; enemies must destroy it to pass.
A door joins same-owner walls or doors along X or along Y, never both: no corners or junctions. A wall that would turn a door, built or reserved, into a corner is rejected.
Walls and doors block movement, not shots. A unit standing in a door can be targeted by its id; the door by the door's id. Doors report open:true/false, and the grid shows a unit standing in one.

## Orders (POST /act {"orders":[...]}, several per call)
- {"type":"train","building":"<castle id>","kind":"worker"|"knight"|"ranger"}
- {"type":"build","unit":"<worker id>","kind":${(k.worker.builds ?? []).map((kind) => JSON.stringify(kind)).join("|")},"x":X,"y":Y}
- {"type":"move","unit":"<id>","x":X,"y":Y}
- {"type":"attack","unit":"<id>","target":"<enemy id>"} (chases until the target dies)
- {"type":"gather","unit":"<worker id>","deposit":"<d id, optional>"}
- {"type":"stop","unit":"<id>"}
An order overrides the unit's script until it ends. Each order returns {"ok":true} or {"ok":false,"reason":"…"}; the response also has capital spent and remaining, and your state.
A build's cost is pending until completion; its spawn event reports the actual charge.

## Unit scripts
${Object.entries(k).filter(([, spec]) => spec.scriptable).map(([kind]) => kind).join(", ")} run a JavaScript function body every tick while they have no order: one script per kind, \`self\` in scope, one action per tick (the first wins).
Upload with PUT /scripts/<kind> {"code":"…","lang":"js"|"ts"} (max ${r.script.maxBytes} bytes).
self: id type x y hp maxHp atk def range minRange vision attackMs moveMs tick memory (per unit, ≤${r.script.memoryBytes} bytes JSON)
perception: nearbyEnemies() nearbyAllies() nearestEnemy() nearestAlly() enemiesInRange() (attackable now: within range and minRange) distanceTo(u) distanceToPos(x,y) enemyBase() myBase()
  (each seen unit: {id,type,owner,mine,${teams ? "ally," : ""}x,y,hp,maxHp,isBuilding}; everything you can see, not only within this unit's vision${teams ? "; allies = yours and your ally's" : ""})
actions: move("N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW") moveTo(x,y) attack(u) flee(u) hold()
reaction: lastAttackedTick (null until hit), lastAttacker() (a visible hostile that hit this unit in the last 5 s, or null). Damage shows on the next tick; a launch alone is not damage.
workers: carrying carryCapacity deposits() nearestDeposit() gather(deposit?) unload(). gather() runs the whole cycle: walks to a known deposit, mines a full load (${r.gather.carry}), carries it to the nearest Castle and goes back; gather(deposit) picks the deposit. unload() delivers what the worker carries before the load is full. Deposits are the known ones, {id,x,y,amount}, nearest first; hidden amounts may be stale.
Defaults: workers gather, also under attack; the King hits a recent attacker in reach and never chases. stop clears an order and resumes the script.
other: random() (seeded), log(msg) (appears in your events). No Date or I/O; CPU is metered, and a unit out of gas holds.
Default knight script:
\`\`\`js
${r.defaultScripts.knight.trim()}
\`\`\`

## Player scripts (POST /run, MCP \`run\`, aoa exec)
A one-shot function body run once on the server, with \`view\` (your state as JSON, including underAttack and lastSeen), \`rules\` (these rules as JSON), \`act(order)\` (the /act shapes except script and chat; max 50) and \`log(...)\` in scope.
Queued orders apply together when it returns, none if it throws. The response has each order's result, the return value (JSON) and the logs. CPU and memory are metered; no network, timers or I/O.
\`\`\`js
const target = view.enemy.filter(e => !e.ruin).sort((a, b) => a.hp - b.hp)[0];
for (const u of view.mine.filter(u => u.kind === "knight"))
  act(target ? { type: "attack", unit: u.id, target: target.id } : { type: "stop", unit: u.id });
return { target: target && target.id };
\`\`\`
${room.chat ? `
## Chat
POST /chat {"text":"..."} (MCP \`chat\`) reaches every player: max 200 chars, one message per 3 s across all channels.
{"text":"...","to":"p2"} (MCP chat to="p2", aoa chat "..." --to p2) is private between you and p2, marked [private to p2]; it works with any player.${teams ? `
{"text":"...","channel":"team"} (MCP chat channel="team", aoa chat "..." --channel team) reaches only your team, marked [team]; it can't be combined with to.` : ""}
Private and team messages are hidden from other players and live spectators, and appear in the replay after the match. Explicit channel="private" requires to.
State shows the last 5 messages you can see; GET /chat (chat without text) returns them all; wait until=chat wakes on a new one. Enemy entities carry owner ids for addressing.
` : ""}
## Phases
waiting and prep: the clock is stopped and nothing can be sent. running: the clock runs, and orders can be sent at any time; no call (wait or state) is required between them. The match is over at status finished.
`;
}
