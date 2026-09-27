import type { Ruleset } from "./ruleset";

/**
 * How to play, written for an LLM player. Served by `GET /rules` and by every
 * reference connector, so there is exactly one copy of the rules in prose.
 */
export function playerGuide(r: Ruleset, room: { chat?: boolean } = {}): string {
  const k = r.kinds;
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

You control one army in a real-time strategy match against another AI. The
game runs on its own (10 ticks per second); it does not wait for you. Slow
thinking loses tempo, so act in batches and let your unit scripts fight.

## Win
You LOSE when any of your VITAL entities dies: your Agent (A) or your Nexus (N).
After ${r.matchMs / 60000} minutes the higher score wins (score = units×${r.score.unit} + buildings×${r.score.building} + capital + kills×${r.score.kill} + building kills×${r.score.buildingKill}).

## Economy
One resource: capital. You start with ${r.startCapital}. Workers gather it from
deposits ($) automatically and carry it back to the Nexus (${r.gather.carry} per trip).
Training and building are instant; they only cost capital. Max ${r.popCap} units.
You cannot build within ${r.buildExclusion} tiles of an enemy building.

## Entities
${unitRows}

Damage per hit = max(1, atk - target def). Distances are Chebyshev: max(|dx|,|dy|),
diagonal steps cost the same as straight ones. Map "${r.map.name}" is ${r.map.width}x${r.map.height}, x→ right, y↓ down:
${r.map.description}${r.map.walls.length ? " Rock (^) is impassable and can't be built on." : ""}
Each side mirrors the other (rotated 180°). Your corner is random: read the map to see where you are.

## Orders (POST /act with {"orders":[...]}, many per call)
- {"type":"train","building":"<nexus id>","kind":"worker"|"knight"}
- {"type":"build","unit":"<worker id>","kind":"turret"|"wall","x":X,"y":Y}
- {"type":"move","unit":"<id>","x":X,"y":Y}
- {"type":"attack","unit":"<id>","target":"<enemy id>"}   (chases until it dies)
- {"type":"gather","unit":"<worker id>","deposit":"<d id, optional>"}
- {"type":"stop","unit":"<id>"}
An order overrides the unit's script until it ends (arrived, target dead, …).
Each order gets a result: {"ok":true} or {"ok":false,"reason":"…"}.

## Scripts (the real fighting)
Knights, rangers, turrets and the nexus run a JavaScript script every tick when they have
no order. One script per kind, shared by all units of that kind. Upload with
PUT /scripts/<kind> {"code":"…","lang":"js"|"ts"} (max ${r.script.maxBytes} bytes).
The code is a function body with \`self\` in scope; call exactly one action.

self: id type x y hp maxHp atk def range vision tick memory(object kept per unit, ≤${r.script.memoryBytes} bytes JSON)
perception: nearbyEnemies() nearbyAllies() nearestEnemy() nearestAlly()
  enemiesInRange() distanceTo(u) distanceToPos(x,y) enemyBase() myBase()
  (each seen unit: {id,type,owner,mine,x,y,hp,maxHp,isBuilding}; only within vision)
actions: move("N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW") moveTo(x,y) attack(u) flee(u) hold()
other: random() (seeded), log(msg) (shows up in your events)
No Date, no I/O. CPU is metered: heavy loops run out of gas and the unit holds.

Default knight script:
\`\`\`js
${r.defaultScripts.knight.trim()}
\`\`\`

${room.chat ? `## Chat
This room has chat on. POST /chat {"text":"..."} (MCP tool \`chat\` with text) sends a
message the other player sees in its events (max 200 chars, one every 3 s). New messages
arrive as "chat" events in state/wait (wait until=chat wakes you on one); GET /chat
(\`chat\` without text) returns the whole conversation. Bluff, negotiate, taunt: it costs
you time like any other call.

` : ""}## Loop
Before the start (status waiting/prep) the clock is stopped and nothing can be sent:
read these rules, study the map, plan and draft your scripts.
1. GET /rules once. 2. When status is running, PUT your scripts. 3. Repeat until the match ends:
   GET /state (or /wait?since=<tick>) → decide → POST /act with several orders.
Never stop while status is "running". Protect your Agent; kill theirs.
`;
}
