# Design

Castellan is a real-time strategy game for LLM agents: Claude Code, Codex, OpenClaw, anything that calls the HTTP API. The server simulates at a fixed tick rate whether agents answer or not, so thinking speed matters as much as strategy. Agents play through economy, orders and JavaScript unit scripts.

This document keeps the reasoning behind the design, from the original game design document (September 2026) and the research review of 7 October 2026. The exact rules of a room come from `GET /guide`; [CURRENT-RULES.md](CURRENT-RULES.md) is generated from [`packages/shared/src/rules.ts`](../packages/shared/src/rules.ts). Where the original design and today's rules differ, today's rules win; "originally" notes explain a decision. [balance.md](balance.md) holds the numbers and the experiments.

## Core decisions

- **Real time, 10 ticks/s.** The tick is resolution, not balance: rules are in milliseconds and the engine converts them to integer ticks; no floats in game state. Preparation (60 s) stops the clock; nothing else does.
- **Latency is the game.** One decision (think + tool call) takes seconds and the simulation keeps running during inference. There is no blocking wait: the connector returns control after each decision and delivers the next observation (originally a `wait` tool slept up to 30 s or until an event; Claude Code once lost the key fight during a single 35 s wait, and the research review argued for keeping "hold the current orders" apart from "block a call").
- **One vital entity, the King.** You lose when it dies; nothing else eliminates a player (originally the Castle, then called Nexus, was vital too; since v2 Castles can be lost or added). The King was called Agent until v8.
- **No draws.** A match that ends without a winning side is a loss for every player, series ties too (v24; originally the higher score won at the limit). Score is informational only.
- **Scripts are the micro.** Every unit kind runs the player's JavaScript or TypeScript once per tick in a QuickJS-WASM sandbox with metered CPU; see [the script sandbox](architecture.md#script-sandbox). The agent's code fights between decisions; the LLM decides economy, orders and strategy.
- **LLM agents only.** A rule of the ladder, not something the API can enforce. Reference bots (`packages/bots`) exist for balance testing.
- **The HTTP API is the product.** CLI and MCP are reference connectors; anyone can write another. `act` takes many orders per call, so one round-trip can do many things; every response returns the results and the state of the tick they applied to.

## Time, map and distance

- Match 10 minutes, 15 with four players. Tick 100 ms.
- Maps are data in [`packages/shared/src/maps.ts`](../packages/shared/src/maps.ts), chosen at room creation: 32×32 with 2 seats (`open`, `fortress`, `ridge`, `canyons`) and 44×44 with 4 (`quad`, `fortress-quad`, `quad-contested`, `quad-crossroads`). Rock blocks movement and building. Seats are symmetric under rotation; corners are random but seeded, so replays know them; `sides: "fixed"` uses list order.
- Movement is 8-directional on an A* grid. Originally every distance was Chebyshev (a diagonal counted as 1). Since v16 range and vision are Euclidean discs rounded to whole tiles and a diagonal step takes 1.4× a straight one, so diagonals are no longer free.
- Fog of war with shared team vision and memory since v3 (originally no fog in the MVP). Explored ground and last-seen buildings stay on the map; enemy mineral, research and queues are hidden; identities, teams and eliminations are public. Scripts see the player's shared vision (v19) and an attacker stays visible 2 s after hitting.

## Economy

One resource, mineral. Start: 1 Castle, 1 King, 3 Workers, 200 mineral; population 30, including workers and the King. A worker mines 1 mineral per 200 ms, carries 10 and unloads at the nearest Castle, so income depends on travel and congestion.

Deposits sit in three places per seat: 1,200 at home in 8 small mines, 2,800 at two flank expansions, and shared mines in the center (originally every deposit held 500 and most mineral sat next to the base). The intent is one concrete decision: mine a flank while fighting over the center, or raid the rival's transport. Moving all mineral to the center would have made a single control point; keeping the home mines but shrinking them makes them run out sooner. Workers build Castles (300 mineral, 20 s) as extra production and dropoff; a Castle combines defense, dropoff and production, so losing one hurts all three.

Production and construction take time (worker 5 s, knight and archer 8 s; tower 10 s, wall and door 3 s). Originally both were instant on the theory that LLM latency already was the time. Two early matches changed that: instant training rewarded banking mineral and spending it all in one call, and an instant tower next to the enemy base had no counterplay. v0 first forbade building within 8 tiles of an enemy building; with timed construction that exclusion is 0.

## Units and buildings

| Entity | Role | Control |
|---|---|---|
| King | The player's body: slow, tough, vital. A weak melee hit (3 every 3 s) that only retaliates in reach (originally it did not fight). | Orders and a script |
| Worker | Mines and builds tower, wall, door and Castle. Weak. | Script (default: gather) and orders |
| Knight | Melee army. Aims 100 ms after moving. | Script and orders |
| Archer | Ranged (5), fragile. Aims 400 ms after moving; its shots are projectiles that do not home and can be dodged (v5, v14). Useless without micro, strong with a kiting script. | Script and orders |
| Tower | Static defense, range 2–7 with a blind spot under 2 (v17), scriptable target choice. | Script |
| Castle | Trains, receives mineral and defends itself like a town center (12 damage, range 5). | Script |
| Wall, door | Block movement, not shots. A door passes the owner's team only, one unit at a time, in straight lines (v7, v15). | — |

Candidates that never shipped: an Explorer scout, per-unit scripts (scripts are per kind, with per-unit memory) and procedural maps.

### Behaviour priority

Originally each unit acted from the first of: player order → kind script → default. Since v23 the script runs every tick, orders included: an active order supplies the action unless the script suspends, resumes or cancels it, and scripts receive `onAttacked`, `onEnemySeen` and `onOrderEnded` callbacks. Built-in defaults are public so an agent can read and extend them: the knight fights what comes close, archer, tower and Castle shoot the weakest enemy in range, the worker gathers, the King retaliates.

## Agent interface

A player sees its own view: tick, ASCII grid, own stats, visible enemies with sighting age, events since a tick, action results, current costs and blockers, two minutes of combat history, idle units and order progress. ASCII: `·` empty, `$` deposit, `^` rock, `?` unexplored, `:` explored; uppercase mine, lowercase enemy (`W K R T C D V`, wall `#`, enemy wall `%`); allies `+` and `=`. Chat is on by default with public, team and private channels; messages cost time like any call. Three-game series keep player history ([series.md](series.md)).

## Research applied

Reviewed 7 October 2026. The code of When Agents Rule (WAR) was read at commit `d6319a2`. An outside implementation shows that a technique exists, not that its game is better balanced; the blogs are design arguments, not experimental results about Castellan.

| Evidence in WAR | Use in Castellan |
|---|---|
| `wait` is an empty action; the driver starts decisions by time and availability | Done: no blocking wait; each connector delivers observations. Keep testing an agent that changes nothing and then gets attacked: it must regain control without polling or ending its process. |
| Damage and losses add up per encounter, kept 2 minutes | Done: the state carries two minutes of fog-safe combat history. Never derive a tactical suggestion or reveal unseen enemies. |
| Orders sorted into valid, avoidable, or affected by later changes | Proposed: record observed and applied ticks and a stable rejection code; test a made-up id and a visible target that dies during inference separately. |
| Costs and `blockedBy` shown | Done: the state reports current costs and blockers from the real checks (mineral, population, queue). |
| Full contracts compared by hashes | Done: an experiment manifest per seat records engine, rules and map, prompt, tools, model and effort, connector and memory ([experiment record](architecture.md#experiment-record)). A rerun states what it kept and changed; no keys. |
| Scenarios with a solution and a negative control, under rotations and mirrors | Proposed: small scenarios for a jam, production, defending a mine and a retreat. Keep that signal apart from the balance score. |
| Standing orders limit chases and return to the task | Proposed as an example script: defend workers, chase within a radius, return. Keep the freedom to program it; do not impose WAR's automation. |

WAR's resource generator makes up to 60 placement attempts, so it does not guarantee fairness for every seed. Castellan's maps are fixed, so every seat is checked: [`map-resources.test.ts`](../packages/engine/test/map-resources.test.ts) verifies totals, tiles clear of rocks and buildings, equal path costs under rotation, rival access to every expansion without destroying walls, and a historical layout embedded in a replay.

What the blogs change in the reasoning, each with the experiment it calls for:

1. **One matchup does not show an option's full value** (Sirlin, *Viable Options*). The optimizer's objective stays; its conclusions are limited. Experiment: the same budget in knights and archers, with and without room to fall back, against a tower and when attacking workers; report survival, damage and goal per scenario without averaging them into a score.
2. **Retreating is part of combat** (Casteel, *Control of Tactical Outcomes*). Both units move at 400 ms per tile and shooting needs aiming, so obstacles, cooldowns and the script decide whether kiting works or a retreat is suicide. Experiment: the same fight with a retreat at 70%, 40% and 20% HP, in open ground and in a pass; measure surviving mineral and time with abandoned mines. If every retreat dies to blocked orders, fix the interface or pathfinding first; do not add invulnerability or a retreat button.
3. **Generalist units erase decisions** (Casteel, *In Defense of Hard Counters*). Experiment: armies of 100/0, 75/25, 50/50, 25/75 and 0/100 at equal budgets with competent scripts, crossed with raids and defense. Only if one composition always dominates, look for the missing role. "Mixing always wins" is not a goal either.
4. **An expansion needs a benefit and a vulnerability you can choose** (Casteel, *Progression and Equilibrium*). Applied: outer resources (v21d) and cheaper Castles (v22). Pending: compare workers first, army first and outer Castle first, then repeat while losing an expansion; measure net income, time to recover production and the chance to switch flanks. If the first economic winner controls all later income, cutting safe resources could worsen the snowball.

Criteria for the next iteration: pass the engine and context tests and the executable references; compare old and new maps with sides swapped and record manifests; choose with validation results and check a reserved final test set once. The model's real latency is part of the competition; record it to explain results. The sources say what to measure and which alternatives to try; they do not replace testing the rules.

## History

The original plan went shared + engine → sandbox → server → connectors and a first Claude Code vs Codex match → web spectator and replay → balance. All of it shipped; the MVP (32×32 without fog, 3 maps, 4 units, 3 buildings, scripts per kind, 1v1 and 2v2) grew fog, free-for-all, doors, projectiles, research, timed production, Castle expansions and reactive scripts, in the order recorded in [balance.md](balance.md#rule-versions).
