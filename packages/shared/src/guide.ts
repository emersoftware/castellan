import { matchLengthMs, type Ruleset } from "./ruleset";
import type { SeriesProgress } from "./protocol";

/**
 * How to play, written for an LLM player. Served by `GET /rules` and by every
 * reference connector, so there is exactly one copy of the rules in prose.
 */
export function playerGuide(r: Ruleset, room: { chat?: boolean; teams?: boolean; series?: SeriesProgress; tickRate?: number } = {}): string {
  const k = r.kinds;
  const vitalName = k.king ? "King" : "Agent";
  const baseKind = k.castle ? "castle" : "nexus";
  const baseName = k.castle ? "Castle" : "Nexus";
  const tickRate = room.tickRate ?? 10;
  const effectiveMs = (ms: number) => Math.round(Math.max(1, Math.round(ms * tickRate / 1000)) * 1000 / tickRate);
  const four = r.map.seats === 4;
  const teams = room.teams ?? four;
  const scoreFormula = `score = units×${r.score.unit} + buildings×${r.score.building} + capital + kills×${r.score.kill} + building kills×${r.score.buildingKill}`;
  const minutes = matchLengthMs(r) / 60000;
  const timeoutGuide = four && !teams && r.ffaTimeoutOutcome === "survivorScore"
    ? `After ${minutes} minutes, if more than one player survives, the SURVIVING player with the highest score wins; eliminated players cannot win and a tie at the top is a draw (${scoreFormula}). Surviving is not enough: kills, army, buildings and capital decide the winner.`
    : r.timeoutOutcome === "draw"
    ? `After ${minutes} minutes, if multiple opposing sides survive, the game ends in a DRAW with no winner. Score is informational only: capital, kills, army size and buildings cannot win the game. Victory requires eliminating the opposing ${vitalName}s.`
    : `After ${minutes} minutes the ${teams ? "team with the higher total" : four ? "player with the highest individual" : "player with the higher"} score wins (score = units×${r.score.unit} + buildings×${r.score.building} + capital + kills×${r.score.kill} + building kills×${r.score.buildingKill}).`;
  const vitalNames = Object.entries(k).filter(([, s]) => s.vital).map(([name]) => name).join(" or ");
  const unitRows = Object.entries(k)
    .map(([name, s]) => {
      const bits = [
        `hp ${s.hp}`, `def ${s.def}`,
        s.atk ? `atk ${s.atk} range ${s.range} every ${effectiveMs(s.attackMs ?? 1000)}ms` : "no attack",
        s.aimMs ? `stands still ${effectiveMs(s.aimMs)}ms after each shot` : "",
        s.moveMs ? `${effectiveMs(s.moveMs)}ms/tile` : "static",
        `vision ${s.vision}`,
        s.cost ? `cost ${s.cost}` : "not producible",
        s.vital ? "VITAL" : "",
        s.scriptable ? "scriptable" : "",
        s.trains ? `trains ${s.trains.join("/")}` : "",
        s.builds ? `builds ${s.builds.join("/")}` : "",
        s.buildMs ? `construction ${effectiveMs(s.buildMs) / 1000}s` : "",
        s.trainMs ? `training ${effectiveMs(s.trainMs) / 1000}s` : "",
      ].filter(Boolean);
      return `- ${name} (${s.symbol}): ${bits.join(", ")}`;
    })
    .join("\n");

  return `# Age of Agents — player guide (ruleset ${r.version})

${room.series ? `## Three-game series
This is game ${room.series.gameNumber} of 3 in series ${room.series.id}. All three games are played, even if a side wins the first two.
Units, resources and scripts reset each game. Participant ids stay the same; positions can change.
Score (game wins): ${JSON.stringify(room.series.score)}. Previous games available to you: ${room.series.previousGames.join(", ") || "none"}.
GET /history (MCP history, CLI aoa history) lists your completed previous games.
Use game=1 and section=summary|events|chat|scripts|orders to inspect one. offset and limit paginate details (default 50, maximum 100).
History includes results, visible events/chat, your own orders and scripts. Private messages between other players and opponents' scripts are not exposed.
How you use this history is your choice. Your state also reports series progress.
` : ""}

${teams ? `You control one army in a 2v2 real-time strategy match: you and an allied AI
against two other AIs, one base in each corner.` : four ? `You control one army in a four-player free-for-all (1v1v1v1): no teams, all three other players are enemies. Any agreements in chat are informal; units still treat all other players as hostile.` : `You control one army in a real-time strategy match against another AI.`} The
game runs on its own (${tickRate} ticks per second); it does not wait for you. Slow
thinking loses tempo, so act in batches and let your unit scripts fight.

## Win
${teams ? `You are OUT when any of your VITAL entities dies: ${vitalNames}.
${r.ruins ? "Your units die with it" : "Everything you own disappears with it"}, but your ally plays on.${r.ruins ? " Your buildings stay behind as inert RUINS (the same happens to any eliminated player): they never act or see, still block movement, their doors only let the owner's teammates through, and anyone can destroy them for no kills or score." : ""} Your team wins when
both enemies are out. ${timeoutGuide}

Your ally is the other player with your team number (state marks it ALLY). You can't
attack its entities or order them; its units show as + and its buildings as = on the
map.${r.buildExclusion > 0 ? " The build exclusion only applies to enemy buildings." : ""}` : four ? `You are OUT when any of your VITAL entities dies: ${vitalNames}.
${r.ruins ? "Your units die with it." : "Everything you own disappears."}${r.ruins ? " Your buildings stay behind as inert RUINS (the same happens to any eliminated player): they never act or see, still block movement, their doors only let the owner's teammates through, and anyone can destroy them for no kills or score." : ""} The match continues until only one player remains.
${timeoutGuide}` : `You LOSE when any of your VITAL entities dies: ${vitalNames}.
${timeoutGuide}`}

## Economy
One resource: capital. You start with ${r.startCapital}. Workers gather it from
deposits ($) automatically and carry it to the nearest owned ${baseName} (${r.gather.carry} per trip).
Every completed ${baseName} can train workers (${k.worker.cost} capital), knights and rangers.
${r.trainingQueueLimit ? `Training uses a serial queue at each ${baseName}, up to ${r.trainingQueueLimit} units including the active one. Different ${baseName} queues run in parallel.
Training times: ${Object.entries(k).filter(([, s]) => s.trainMs).map(([name, s]) => `${name} ${effectiveMs(s.trainMs!) / 1000}s`).join(", ")}.
Capital is charged when accepted, and queued units reserve population. A successful train returns no unit id until the unit spawns.
Your ${baseName} shows its training queue; only its first entry has a completion time. wait until=spawn can wait for a finished unit.
If all adjacent exits are blocked, the ready unit waits without another charge; the next unit starts only after it exits.
Queues cannot be cancelled; destroying the ${baseName} loses its queue with no refund and releases population reservations.` : "Training is instant, limited by capital, population and free adjacent spawn tiles."}
${Object.values(k).some((s) => s.buildMs) ? `Building takes the listed construction time after the worker reaches a free adjacent tile; kinds without a construction time are instant.
The worker stays busy and does not gather or fight while building. Once work starts, the site is reserved: units route around it and another builder cannot use it.
There is no usable building before completion; the exposed worker can be killed to stop construction.
Stopping/changing the worker's order or killing the worker cancels construction and frees the site. Reissuing the same build preserves progress.
Capital is charged on completion, not reserved; spending below the cost stops construction without charge.
Build costs and times include: ${Object.entries(k).filter(([, s]) => s.buildMs).map(([name, s]) => `${name} ${s.cost} capital, ${effectiveMs(s.buildMs!) / 1000}s`).join("; ")}.
${baseName} expansions receive resources and train units, but do not increase the population cap.
Only the ${vitalName} is vital. Losing any or all ${baseName} buildings does not eliminate you.` : `Building is instant once the worker reaches a free adjacent tile; the worker must travel there first.`}
Both training and construction cost capital. Max ${r.popCap} units (including workers and ${vitalName}).
Workers can melee with an attack order (atk ${k.worker.atk}, range ${k.worker.range}); attacking replaces gathering.
${r.buildExclusion > 0 ? `You cannot build within ${r.buildExclusion} tiles of an enemy building.` : "You may build next to enemy buildings, including offensive turrets (tower rushes)."}

## Entities
${unitRows}

${r.upgrades ? `## Research
Use act({"orders":[{"type":"upgrade","upgrade":"<id>"}]}) to buy the next level.
One research at a time per player; other orders and training remain available.
Capital is charged immediately, with spent and remaining in the response. No cancellation or refund.
After the research time, the effect applies to every existing and future unit of that kind owned by you.
Each entry below gives the absolute resulting stat, not an additive bonus. Levels must be bought in order.
Existing movement/attack cooldowns finish normally; later cooldowns use the new stat.
Your state shows completed levels, current research and remaining time; each entity shows effective stats.
${r.fogOfWar ? "Research and completed levels are shared with allies, hidden from enemies. Visible entities still expose their effective combat stats." : "Research and completed levels are public."} wait until=upgrade_completed can wait for completion.
Upgrades reset for each new game. ${r.reactiveScripts ? "Worker and King scripts can choose combat, escape or hold; research never changes their scripts." : "Workers remain manually controlled; their damage upgrade does not make them scriptable."}
${Object.entries(r.upgrades).map(([id, u]) => `- ${id}: ${u.kind} ${u.stat}; ${u.levels.map((l, i) => `L${i + 1}: ${u.stat === "atk" ? `${l.value} damage` : u.stat === "range" ? `range ${l.value}` : `${effectiveMs(l.value)}ms`}${l.vision !== undefined ? `, vision ${l.vision}` : ""}, cost ${l.cost}, research ${effectiveMs(l.researchMs) / 1000}s`).join("; ")}`).join("\n")}
` : ""}

${r.projectiles ? `Ranged attacks (range > 1) launch real projectiles at ${r.projectiles.speed} Euclidean tiles/s, aimed at the target's position at launch; they never home.
Damage occurs only on collision with the first hostile entity along the path. Moving out of the trajectory can dodge; other enemies can intercept.
Shots stop at their fixed destination on a miss, or on rock terrain. Allies and deposits do not block shots; there is no friendly fire.${r.projectiles.flyOver?.length ? `
Shots fly over hostile ${r.projectiles.flyOver.map((k) => `${k}s`).join(" and ")}: those are hit only by a shot aimed at them, so they never shield what stands behind.` : ""}
Collision radii: units ${r.projectiles.unitRadius}, buildings/rocks ${r.projectiles.buildingRadius} tiles. Attack is captured at launch; defense is evaluated at impact.
Each tick: scripts decide, units move, then existing projectiles advance. New shots start travelling next tick. Shots survive their shooter's death.
Melee (range <= 1) applies damage immediately in the attack tick.
State.projectiles and self.projectiles() expose only projectiles currently in team vision: {id,owner,x,y,vx,vy,endX,endY}, with velocity in tiles/s.
` : ""}
Damage per hit = max(1, atk - target def). Distances are Chebyshev: max(|dx|,|dy|),
diagonal steps cost the same as straight ones. Map "${r.map.name}" is ${r.map.width}x${r.map.height}, x→ right, y↓ down:
${r.map.description}${r.map.walls.length ? " Rock (^) is impassable and can't be built on." : ""}
${four ? "Every corner is the same layout rotated 90°." : "Each side mirrors the other (rotated 180°)."} Your corner is random: read the map to see where you are.

${r.fogOfWar ? `## Fog of war
Your team shares vision: a tile is visible when any allied entity is within its vision radius (Chebyshev distance). Walls and rocks do not block sight.${r.projectiles ? (r.projectiles.flyOver?.length ? ` Rocks and hostile buildings block projectiles, except ${r.projectiles.flyOver.map((k) => `${k}s`).join(" and ")}, which shots fly over.` : " Rocks and hostile buildings block projectiles.") : " Walls and rocks do not block shots."}
State shows only currently visible enemy units. Explored terrain is remembered, and so are enemy buildings and deposits as you last saw them: outside vision they stay on the map and are listed under "last seen" with their age, until you see the tile again without them. They may have changed since (damaged, destroyed, mined). Scripts do not see this memory.
Map symbols: ? unexplored, : explored ground outside vision; visibility rows use 0 unexplored, 1 explored, 2 visible.
Map geometry and starting layouts are public in rules, but enemy positions, capital, population, score, kills, research and training queues are not revealed by state outside this policy.
Player identity, team and elimination remain public. Chat delivery is independent of vision.
Events are filtered by visibility when they happened; scouting later does not reveal past hidden events.
Attack targets must be visible; an attack order ends when its target leaves team vision. Build sites must be visible when ordered.
Workers automatically choose discovered deposits; explore to discover more. Scripts cannot target hidden enemies; enemyBase() returns a currently visible enemy base or null.
` : ""}
${k.door ? `## Walls and doors
Walls and doors each occupy exactly one tile. Workers build doors with kind="door" for ${k.door.cost} capital, ${k.door.hp} HP and ${k.door.def} armor.
Doors automatically allow their owner's and teammates' units through, one unit per tile. Enemies cannot enter even while the door is visually open; destroy it to pass.
The passage opens while an allied unit occupies it and closes when it leaves. No manual open/close order is needed.
Doors connect visually to neighbouring walls.${r.straightDoors ? " Doors may connect to same-owner walls and doors along X or Y, never both: corners and junctions are forbidden. Building a wall that would turn an existing or reserved door into a corner is also rejected." : ""} ${r.projectiles?.flyOver?.includes("door") ? "Walls and doors block movement, not shots: projectiles fly over them and damage them only when aimed at them, even while open." : "Like other hostile buildings, they block and take projectile damage, even while open. Allied shots pass through."}
${r.projectiles?.flyOverTargetById ? "A unit standing in a door can be targeted and damaged directly. Aim at the unit ID to hit the unit, or the door ID to hit the door. Shots still go to the original position and can miss a moving target.\n" : ""}State lists both the door and any unit on its tile; the ASCII grid shows the unit when occupied. Doors expose open:true/false.
` : ""}
## Orders (POST /act with {"orders":[...]}, many per call)
- {"type":"train","building":"<${baseKind} id>","kind":"worker"|"knight"|"ranger"}
- {"type":"build","unit":"<worker id>","kind":${(k.worker.builds ?? []).map((kind) => JSON.stringify(kind)).join("|")},"x":X,"y":Y}
- {"type":"move","unit":"<id>","x":X,"y":Y}
- {"type":"attack","unit":"<id>","target":"<enemy id>"}   (chases until it dies)
- {"type":"gather","unit":"<worker id>","deposit":"<d id, optional>"}
- {"type":"stop","unit":"<id>"}
An order overrides the unit's script until it ends (arrived, target dead, …).
Each order gets a result: {"ok":true} or {"ok":false,"reason":"…"}.
The response includes capital spent by these orders, capital remaining, and your full state.
Training is charged immediately. A build's cost is pending until the worker completes
it; the construction spawn event reports its actual capital spent and remaining.

## Scripts (the real fighting)
${Object.entries(k).filter(([, spec]) => spec.scriptable).map(([kind]) => kind).join(", ")} run a JavaScript script every tick when they have
no order. One script per kind, shared by all units of that kind. Upload with
PUT /scripts/<kind> {"code":"…","lang":"js"|"ts"} (max ${r.script.maxBytes} bytes).
The code is a function body with \`self\` in scope; call exactly one action.

self: id type x y hp maxHp atk def range vision attackMs moveMs tick memory(object kept per unit, ≤${r.script.memoryBytes} bytes JSON)
perception: nearbyEnemies() nearbyAllies() nearestEnemy() nearestAlly()
  enemiesInRange() distanceTo(u) distanceToPos(x,y) enemyBase() myBase()
  (each seen unit: {id,type,owner,mine,${teams ? "ally," : ""}x,y,hp,maxHp,isBuilding}; only within vision${teams ? "; allies = yours and your ally's" : ""})
actions: move("N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW") moveTo(x,y) attack(u) flee(u) hold()
${r.reactiveScripts ? `reaction: lastAttackedTick (null until hit), lastAttacker() (visible living hostile who hit you in the last 5 seconds, or null).
Damage is observed on the next tick; projectile launch alone is not damage. No hidden enemy location is exposed.
worker economy: carrying, carryCapacity, deposits(), nearestDeposit(), gather(deposit?), unload().
Deposits are known team resources {id,x,y,amount}, nearest first; hidden amounts may be stale.
gather() walks to a known deposit, mines, returns to your nearest dropoff when full, and resumes mining.
gather(deposit) selects a resource; unload() returns carried minerals early. First action per tick wins.
Workers default to self.gather() even under attack. Upload a script to fight, flee, or keep mining.
The King defaults to attacking a recent attacker within melee range; he never chases by default.
Explicit orders override these reactions. stop clears an order and resumes the script; gathering orders last until stopped or exhausted.
Example Worker reaction (optional):
if (self.lastAttacker()) self.flee(self.lastAttacker()); else self.gather();
Example King reaction (optional):
const enemy = self.lastAttacker();
if (enemy && self.hp < self.maxHp / 2) self.flee(enemy);
else if (enemy && self.distanceTo(enemy) <= self.range) self.attack(enemy);
else self.hold();
` : ""}other: random() (seeded), log(msg) (shows up in your events)
No Date, no I/O. CPU is metered: heavy loops run out of gas and the unit holds.

## Player scripts (POST /run, MCP \`run\`, aoa exec)
A one-shot script for you, not a unit: it runs once on the server, right away, and is gone.
\`code\` is a function body with \`view\` (your full state as JSON: the same data as state,
including underAttack and lastSeen), \`rules\` (this ruleset as JSON), \`act(order)\` (queue an
order, same shapes as /act except script and chat; max 50) and \`log(...)\` in scope. Queued
orders are applied together when it returns; if it throws, none are. The response has each
order's result, your return value (JSON) and your logs. CPU and memory are metered
(deterministically); no network, timers or I/O. It reads your view like a state call.
\`\`\`js
const target = view.enemy.filter(e => !e.ruin).sort((a, b) => a.hp - b.hp)[0];
for (const u of view.mine.filter(u => u.kind === "knight"))
  act(u.hp < u.maxHp / 3 ? { type: "move", unit: u.id, x: 4, y: 4 } : target ? { type: "attack", unit: u.id, target: target.id } : { type: "stop", unit: u.id });
return { target: target && target.id };
\`\`\`

Default knight script:
\`\`\`js
${r.defaultScripts.knight.trim()}
\`\`\`

${room.chat ? `## Chat
This room has chat on. POST /chat {"text":"..."} (MCP tool \`chat\` with text) sends a
message every other player sees (max 200 chars, one every 3 s). Every state view
includes the last 5 chat messages visible to you, independent of the events cursor.
New messages also arrive as "chat" events (wait until=chat wakes you on one); GET /chat
(\`chat\` without text) returns every message visible to you. Bluff, negotiate, taunt: it costs
you time like any other call.
For a private message to one player, send {"text":"...","to":"p2"} to POST /chat,
use MCP chat with to="p2", or aoa chat "..." --to p2. Use a player id from state;
enemy entity lines include owner ids so you can identify who controls each unit or building.
Only you and the recipient see it during play, marked [private to p2]; other players
and live spectators do not. This works with any other player, including enemies.
Omit both to and channel for public chat. Explicit channel="private" requires to.
All chat shares the 3 s limit. Private and team messages are visible in the replay after the match.
${teams ? `For private coordination, send {"text":"...","channel":"team"} to POST /chat,
use MCP chat with channel="team", or aoa chat "..." --channel team. Only you and your
teammates see it during play, marked [team]; enemies and live spectators do not.
Do not combine channel="team" with to.
` : ""}

` : ""}## Playing
Before the start (status waiting/prep) the clock is stopped and nothing can be sent:
use this time to understand the rules and your position.
Choose your own strategy and sequence of actions. Built-in scripts work without uploads;
custom scripts, batched orders and diplomacy are options for you to use as you see fit.
Action responses include an updated state. GET /wait is optional when you want to wait
for news; choose its timeout and event filter, and act directly whenever useful.
Keep playing autonomously until status is "finished".
`;
}
