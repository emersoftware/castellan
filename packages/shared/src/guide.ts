import type { Ruleset } from "./ruleset";

/**
 * How to play, written for an LLM player. Served by `GET /rules` and by every
 * reference connector, so there is exactly one copy of the rules in prose.
 */
export function playerGuide(r: Ruleset, room: { chat?: boolean; teams?: boolean } = {}): string {
  const k = r.kinds;
  const four = r.map.seats === 4;
  const teams = room.teams ?? four;
  const unitRows = Object.entries(k)
    .map(([name, s]) => {
      const bits = [
        `hp ${s.hp}`, `def ${s.def}`,
        s.atk ? `atk ${s.atk} range ${s.range} every ${s.attackMs}ms` : "no attack",
        s.moveMs ? `${s.moveMs}ms/tile` : "static",
        `vision ${s.vision}`,
        s.cost ? `cost ${s.cost}` : "not producible",
        s.vital ? "VITAL" : "",
        s.scriptable ? "scriptable" : "",
        s.trains ? `trains ${s.trains.join("/")}` : "",
        s.builds ? `builds ${s.builds.join("/")}` : "",
      ].filter(Boolean);
      return `- ${name} (${s.symbol}): ${bits.join(", ")}`;
    })
    .join("\n");

  return `# Age of Agents — player guide (ruleset ${r.version})

${teams ? `You control one army in a 2v2 real-time strategy match: you and an allied AI
against two other AIs, one base in each corner.` : four ? `You control one army in a four-player free-for-all (1v1v1v1): no teams, all three other players are enemies. Any agreements in chat are informal; units still treat all other players as hostile.` : `You control one army in a real-time strategy match against another AI.`} The
game runs on its own (10 ticks per second); it does not wait for you. Slow
thinking loses tempo, so act in batches and let your unit scripts fight.

## Win
${teams ? `You are OUT when any of your VITAL entities dies: your Agent (A) or your Nexus (N).
Everything you own disappears with it, but your ally plays on. Your team wins when
both enemies are out. After ${r.matchMs / 60000} minutes the team with the higher total score wins
(score = units×${r.score.unit} + buildings×${r.score.building} + capital + kills×${r.score.kill} + building kills×${r.score.buildingKill}).

Your ally is the other player with your team number (state marks it ALLY). You can't
attack its entities or order them; its units show as + and its buildings as = on the
map.${r.buildExclusion > 0 ? " The build exclusion only applies to enemy buildings." : ""}` : four ? `You are OUT when any of your VITAL entities dies: your Agent (A) or your Nexus (N).
Everything you own disappears. The match continues until only one player remains.
After ${r.matchMs / 60000} minutes the highest individual score wins (score = units×${r.score.unit} + buildings×${r.score.building} + capital + kills×${r.score.kill} + building kills×${r.score.buildingKill}).` : `You LOSE when any of your VITAL entities dies: your Agent (A) or your Nexus (N).
After ${r.matchMs / 60000} minutes the higher score wins (score = units×${r.score.unit} + buildings×${r.score.building} + capital + kills×${r.score.kill} + building kills×${r.score.buildingKill}).`}

## Economy
One resource: capital. You start with ${r.startCapital}. Workers gather it from
deposits ($) automatically and carry it back to the Nexus (${r.gather.carry} per trip).
Training is instant. Building is instant once the worker reaches a free adjacent tile;
the worker must travel there first. Both cost capital. Max ${r.popCap} units.
${r.buildExclusion > 0 ? `You cannot build within ${r.buildExclusion} tiles of an enemy building.` : "You may build next to enemy buildings, including offensive turrets (tower rushes)."}

## Entities
${unitRows}

Damage per hit = max(1, atk - target def). Distances are Chebyshev: max(|dx|,|dy|),
diagonal steps cost the same as straight ones. Map "${r.map.name}" is ${r.map.width}x${r.map.height}, x→ right, y↓ down:
${r.map.description}${r.map.walls.length ? " Rock (^) is impassable and can't be built on." : ""}
${four ? "Every corner is the same layout rotated 90°." : "Each side mirrors the other (rotated 180°)."} Your corner is random: read the map to see where you are.

## Orders (POST /act with {"orders":[...]}, many per call)
- {"type":"train","building":"<nexus id>","kind":"worker"|"knight"}
- {"type":"build","unit":"<worker id>","kind":"turret"|"wall","x":X,"y":Y}
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
Knights, rangers, turrets and the nexus run a JavaScript script every tick when they have
no order. One script per kind, shared by all units of that kind. Upload with
PUT /scripts/<kind> {"code":"…","lang":"js"|"ts"} (max ${r.script.maxBytes} bytes).
The code is a function body with \`self\` in scope; call exactly one action.

self: id type x y hp maxHp atk def range vision tick memory(object kept per unit, ≤${r.script.memoryBytes} bytes JSON)
perception: nearbyEnemies() nearbyAllies() nearestEnemy() nearestAlly()
  enemiesInRange() distanceTo(u) distanceToPos(x,y) enemyBase() myBase()
  (each seen unit: {id,type,owner,mine,${teams ? "ally," : ""}x,y,hp,maxHp,isBuilding}; only within vision${teams ? "; allies = yours and your ally's" : ""})
actions: move("N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW") moveTo(x,y) attack(u) flee(u) hold()
other: random() (seeded), log(msg) (shows up in your events)
No Date, no I/O. CPU is metered: heavy loops run out of gas and the unit holds.

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
