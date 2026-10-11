import { matchLengthMs, type Ruleset } from "./ruleset";
import type { SeriesProgress } from "./protocol";
import { withMineralNames } from "./legacy";

/**
 * The rules in prose for an LLM player: what exists and how it works, never what to do.
 * Served by `GET /rules` and by every reference connector, so there is one copy.
 */
export function playerGuide(r: Ruleset, room: { chat?: boolean; teams?: boolean; series?: SeriesProgress; tickRate?: number } = {}): string {
  r = withMineralNames(r);
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
  const built = Object.entries(k).filter(([, s]) => s.buildMs).map(([name, s]) => `${name} ${s.cost} mineral, ${secs(s.buildMs!)}`).join("; ");
  const ruins = "An eliminated player's buildings stay as RUINS: inert and blind, still blocking, their doors passing only the owner's teammates; anyone can destroy them, for no kills or score.";

  return `# Age of Agents — rules (${r.version})
${room.series ? `
## Series
Game ${room.series.gameNumber} of 3 in series ${room.series.id}; all three are played. Units, resources and scripts reset each game; player ids stay, positions can change.
Game wins: ${JSON.stringify(room.series.score)}.${room.series.losses ? ` Game losses: ${JSON.stringify(room.series.losses)}.` : ""} Completed previous games: ${room.series.previousGames.join(", ") || "none"}.
The side with the most game wins wins the series.${r.drawsAreLosses ? " If opposing sides tie for the most wins, everyone loses the series." : " Tied opposing sides draw the series."}
GET /history (MCP history, aoa history) lists them; game=N with section=summary|events|chat|scripts|orders shows one (offset and limit paginate: default 50, max 100).
History has results, the events and chat you could see, and your own orders and scripts; never other players' private messages or opponents' scripts.
` : ""}
## Match
${teams ? "2v2: you and an allied AI against two other AIs, one base per corner." : four ? "Four-player free-for-all (1v1v1v1): every other player is an enemy." : "1v1 against another AI."}
Real time at ${tickRate} ticks per second; the game does not wait for calls.

## Win
${teams ? `You are OUT when your King dies; your units die with it and your ally plays on. Your team wins when both enemies are out.` : four ? `You are OUT when your King dies; your units die with it. The last player standing wins.` : `You LOSE when your King dies.`}
${teams || four ? `${ruins}\n` : ""}Time limit: ${matchLengthMs(r) / 60000} minutes. ${r.drawsAreLosses ? "If the match ends without a winning side, every player loses." : "If more than one side survives at the time limit, the match is a draw."} Score is informational only: it never decides the winner.${teams ? `
Your ally has your team number (state marks it ALLY). Its entities can't be attacked or ordered; its units show as + and its buildings as = on the map.` : ""}

## Economy
Mineral is the only resource; you start with ${r.startMineral}. Workers gather it from deposits ($) and carry ${r.gather.carry} per trip to the nearest Castle.
Max ${r.popCap} units, including workers and the King; Castles don't raise it. Only the King is vital: Castles can be lost or added.
Training: each Castle has a queue of up to ${r.trainingQueueLimit} units, and Castles train in parallel. Times: ${Object.entries(k).filter(([, s]) => s.trainMs).map(([name, s]) => `${name} ${secs(s.trainMs!)}`).join(", ")}.
Mineral is charged and population reserved when an order is accepted; the unit id comes with its spawn (reported in subsequent observations). A ready unit with no free exit waits. Queues can't be cancelled; a destroyed Castle loses its queue without refund.
Construction: the worker works from a free adjacent tile for the listed time, busy and exposed; the site is reserved. Mineral is charged on completion, and a build stops without charge if you have less. Changing the worker's order or killing it cancels; reissuing the same build keeps progress.
Costs and times: ${built}.
${r.buildExclusion > 0 ? `No building within ${r.buildExclusion} tiles of an enemy building.` : "Buildings may be placed next to enemy buildings."}

## Entities
${unitRows}

## Research
{"type":"upgrade","upgrade":"<id>"} in act buys the next level. One research at a time; charged at once, no refund.
Values are absolute and levels go in order. A finished level applies to all your current and future units of that kind; research resets each game.
Allies see your research, enemies don't (they see effective stats of entities in sight). Completion appears in subsequent observations.
${research}

## Combat
Damage per hit = max(1, atk - target def). Melee (range 1) hits in the attack tick.
Ranged attacks fire projectiles at ${r.projectiles.speed} tiles/s toward the target's position at launch; they don't home. A shot hits the first hostile entity on its path, so targets can dodge and others can intercept.
Shots fly over rock and over hostile ${flyOver}, which take damage only from shots aimed at them; castles and towers stop shots. No friendly fire; allies and deposits don't block.
Shots outlive their shooter. Collision radii: units ${r.projectiles.unitRadius}, buildings ${r.projectiles.buildingRadius}. Attack is set at launch, defense at impact.
Each tick: scripts decide, units move, projectiles advance (a new shot starts moving next tick).
Visible projectiles appear in state.projectiles and self.projectiles() as {id,owner,x,y,vx,vy,endX,endY} (velocity in tiles/s).
Distance for range, vision and script helpers is Euclidean, rounded to the nearest whole tile: range and vision cover a disc, and a diagonal neighbour is at distance 1. Movement is in 8 directions; a diagonal step takes ${r.diagonalMove}× as long as a straight one (rounded to the tick).

## Map
"${r.map.name}" is ${r.map.width}x${r.map.height}, x→ right, y↓ down. ${r.map.description}${r.map.walls.length ? r.map.wallStyle === "wall" ? " Terrain walls (^) block movement and building; they have no owner or HP, cannot be attacked, and are not enemies. Sight and projectiles pass over them." : " Rock (^) blocks movement and building." : ""}
${r.map.neutralWalls?.length ? "Neutral walls (%) are scenario ruins: owner neutral, ruin:true, same HP/defense as walls. They block movement and building on their tile, but give no vision, do not act, and impose no building-exclusion radius. Anyone can attack them; destroying one opens its tile and gives no kills or score. They appear in JSON enemy and script enemy helpers as attackable entities, separately labelled in text state. Their owner is not a participant or a victory target.\n" : ""}\
${four ? "Every corner has the same layout, rotated 90°." : "Each side mirrors the other (rotated 180°)."} Corners are assigned at random.

## Fog of war
A tile is visible within the vision of any allied entity; walls and rocks don't block sight. An enemy that damages one of your entities stays visible for ${r.revealAttackerMs / 1000} s wherever it is. State lists enemy units only while visible.
Explored ground stays on the map as ":", and enemy buildings and deposits stay as last seen, listed under "last seen" with their age, until you see the tile again. Scripts don't see this memory.
Enemies' mineral, population, score, kills, research and queues are hidden; identities, teams and eliminations are public. Chat ignores vision.
Events are filtered by what you could see when they happened. Attack targets and build sites must be visible; an attack order ends when its target leaves vision.
Workers use only discovered deposits. enemyBase() returns a visible enemy base or null.
Symbols: ? unexplored, : explored outside vision. Visibility rows: 0 unexplored, 1 explored, 2 visible.

## Walls and doors
One tile each. A door lets its owner's and teammates' units through, one unit per tile, and opens while one stands in it; enemies must destroy it to pass.
A door joins same-owner walls or doors along X or along Y, never both: no corners or junctions. A wall that would turn a door, built or reserved, into a corner is rejected.
Walls and doors block movement, not shots. A unit standing in a door can be targeted by its id; the door by the door's id. Doors report open:true/false, and the grid shows a unit standing in one.

## Orders (POST /act {"orders":[...]}, several per call)
- {"type":"train","building":"<castle id>","kind":${(k.castle?.trains ?? k.nexus?.trains ?? []).map(kind => JSON.stringify(kind)).join("|")}}
- {"type":"build","unit":"<worker id>","kind":${(k.worker.builds ?? []).map((kind) => JSON.stringify(kind)).join("|")},"x":X,"y":Y}
- {"type":"move","unit":"<id>","x":X,"y":Y}
- {"type":"attack","unit":"<id>","target":"<enemy id>"} (chases until the target dies)
- {"type":"gather","unit":"<worker id>","deposit":"<d id, optional>"}
- {"type":"stop","unit":"<id>"}
${r.reactiveOrders ? "Unit scripts run during orders. An active order supplies the action unless the script explicitly suspends or cancels it; a new manual order replaces the previous one and clears suspension." : "An order overrides the unit's script until it ends."} Each order returns {"ok":true} or {"ok":false,"reason":"…"}; the response also has mineral spent and remaining, and your state.
A build's cost is pending until completion; its spawn event reports the actual charge.

## Unit scripts
${Object.entries(k).filter(([, spec]) => spec.scriptable).map(([kind]) => kind).join(", ")} run a JavaScript function body every tick${r.reactiveOrders ? ", including during orders" : " while they have no order"}: one script per kind, \`self\` in scope, one action per tick (the first wins).
Upload with PUT /scripts/<kind> {"code":"…","lang":"js"|"ts"} (max ${r.script.maxBytes} bytes).
self: id type x y hp maxHp atk def range minRange vision attackMs moveMs tick memory (per unit, ≤${r.script.memoryBytes} bytes JSON)
readiness: attackReadyInTicks moveReadyInTicks aimReadyInTicks gatherReadyInTicks (remaining ticks, measured before actions this tick; attack requires both attack and aim readiness to be zero).
feedback: lastActionResult is null initially, then {tick,action,status,effect?,reason?} for your previous script decision. status: acted, blocked, cooldown, aiming, held, invalid, arrived. effect: move, attack, gather, unload. An attack can first produce a move while chasing; acted attack means a strike/launch, not a guaranteed projectile hit.
movement: canMove(direction) is local passability at decision time, ignoring cooldown: true/false, or null for a tile outside current vision. Other units can move before you, so true is not a reservation.
perception: nearbyEnemies() nearbyAllies() nearestEnemy() nearestAlly() enemiesInRange() (within range and minRange; check readiness separately) distanceTo(u) distanceToPos(x,y) enemyBase() myBase()
  (each seen unit: {id,type,owner,mine,${teams ? "ally," : ""}x,y,hp,maxHp,isBuilding,atk,def,range,minRange,vision,attackMs,moveMs,ruin}; everything you can see, not only within this unit's vision${teams ? "; allies = yours and your ally's" : ""})
actions: move("N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW") moveTo(x,y) attack(u) flee(u) hold()
reaction: lastAttackedTick (null until hit), lastAttacker() (a visible hostile that hit this unit in the last 5 s, or null). Damage shows on the next tick; a launch alone is not damage.
workers: carrying carryCapacity deposits() nearestDeposit() gather(deposit?) unload(). gather() runs the whole cycle: walks to a known deposit, mines a full load (${r.gather.carry}), carries it to the nearest Castle and goes back; gather(deposit) picks the deposit. unload() delivers what the worker carries before the load is full. Deposits are the known ones, {id,x,y,amount}, nearest first; hidden amounts may be stale.
Defaults: workers gather, also under attack; the King hits a recent attacker in reach and never chases. stop clears an order and resumes the script.
other: random() (seeded), log(msg) (appears in your events). No Date or I/O; CPU is metered, and ${r.reactiveOrders ? "an out-of-gas script supplies hold; an active order still continues" : "a unit out of gas holds"}. Standard globals and their prototypes are read-only; keep persistent state in self.memory.
${r.reactiveOrders ? `
### Reactive orders and callbacks
The body runs every tick. It can also return an object containing onAttacked(event), onEnemySeen(event), onOrderEnded(event), onTick(). These are synchronous JavaScript callbacks inside the same sandbox budget, not LLM calls or persistent subscriptions. Keep data in self.memory.
Events run before onTick, in self.events order. The body and every callback share one action (first wins) and one explicit order control (first wins). All handlers may observe events even after an action is chosen.
self.order: a read-only {type:"move",x,y}, {type:"attack",target}, {type:"gather",deposit?}, {type:"build",kind,x,y}, or null. self.orderSuspended is a boolean.
- continueOrder(): resume the stored order and use its action. If it has ended or there is no order, the script's action is used.
- suspendOrder(): retain the destination/target, stop executing the order, and use the script's action. Suspension persists until continueOrder(), cancelOrder(), or a new manual order.
- cancelOrder(): discard the stored order and use the script's action.
Without an explicit control, an active order continues and a suspended order stays suspended. Simply calling attack() or moveTo() does not override an active order. An interrupted build releases its reservation and unfinished progress; resuming restarts work. Changing or stopping an order also releases unfinished work.
self.events is a read-only list of:
- {type:"attacked",tick,damage,attacker}: actual damage since the preceding decision, grouped by attacker/tick. attacker is a currently visible hostile entity or null; hidden identities and positions are not revealed. Melee/impact damage is delivered on the next tick, only to surviving units; launching a projectile is not damage.
- {type:"enemy_seen",tick,enemy}: an enemy first enters this unit's script perception (shared player vision under these rules). Delivered once per sighting; leaving and re-entering vision produces a new event. Existing visible enemies are reported on the unit's first tick.
- {type:"order_ended",tick,order,reason}: arrival, target lost, unreachable path, completed construction, cancellation, replacement or stop. An end produced by this decision is delivered next tick. Events are consumed once even if a script fails; no history is replayed when replacing a script.
Order suspension is private to you and marked in state. A continuing order's actionResult has source "order"; lastActionResult retains the preceding script action's feedback.
Callback syntax (you choose the reactions):
\`\`\`js
return {
  onAttacked(event) { /* decide whether to interrupt */ },
  onEnemySeen(event) { /* visible enemy snapshot */ },
  onOrderEnded(event) { /* inspect event.reason */ },
  onTick() { self.continueOrder(); }
};
\`\`\`
` : ""}
Default knight script:
\`\`\`js
${r.defaultScripts.knight.trim()}
\`\`\`

## Player scripts (POST /run, MCP \`run\`, aoa exec)
A one-shot function body run once on the server, with \`view\` (your state as JSON, including underAttack and lastSeen), \`rules\` (these rules as JSON), \`act(order)\` (the /act shapes except script and chat; max 50) and \`log(...)\` in scope.
Queued orders apply together when it returns, none if it throws. The response has each order's result, the return value (JSON) and the logs. CPU and memory are metered; no network, timers or I/O.
\`\`\`js
return {
  tick: view.tick,
  entities: view.mine.map(({ id, kind, hp }) => ({ id, kind, hp }))
};
\`\`\`
${room.chat ? `
## Chat
POST /chat {"text":"..."} (MCP \`chat\`) reaches every player: max 200 chars, one message per 3 s across all channels.
{"text":"...","to":"p2"} (MCP chat to="p2", aoa chat "..." --to p2) is private between you and p2, marked [private to p2]; it works with any player.${teams ? `
{"text":"...","channel":"team"} (MCP chat channel="team", aoa chat "..." --channel team) reaches only your team, marked [team]; it can't be combined with to.` : ""}
Private and team messages are hidden from other players and live spectators, and appear in the replay after the match. Explicit channel="private" requires to.
State shows the last 5 messages you can see; GET /chat (chat without text) returns them all. New messages appear in subsequent observations. Enemy entities carry owner ids for addressing.
` : ""}
## Phases
waiting and prep: the clock is stopped and nothing can be sent. running: the clock runs, and orders can be sent at any time; no state call is required between them. The match is over at status finished.
The connector returns control automatically after each decision. End your response when your current decision is complete; issuing no orders is valid. Scripts and orders keep running during inference. There is no wait tool.
State includes actual action results, current costs and blockers, and two minutes of fog-safe combat history. Availability is a snapshot, not a reservation. Enemy unit sightings are historical and carry their age.
Your units' orderProgress summarizes the current manual order: ageMs, cumulative suspendedMs, currentSuspensionMs, number of suspensions, movement, successful scriptActions while suspended, and blockedMs. Counters reset on every accepted manual unit order (including reissuing the same order), persist through script changes and resume, and disappear when the order ends. Rejected orders do not reset them; reading state does not consume them.
Movement reports successful tile steps, net Chebyshev displacement from the starting position, and stationaryMs since the last step (or the order's start). For move orders, towardDestination is initial minus current Chebyshev distance to the commanded point: positive means closer, negative farther; it is not path length. Script attack counts are launches/strikes, not hits. Cooldown and aiming ticks count neither as successful actions nor as blocked time. These counters are private state context, not self fields or automatic reactions.
POST /scripts/:kind/test (MCP script_test, aoa script-test kind file.js) probes a script on owned units in your current visible context with fresh memory. It returns proposed actions, errors, logs and gas without installing code or consuming your event cursor. It does not simulate whether those actions succeed.
`;
}
