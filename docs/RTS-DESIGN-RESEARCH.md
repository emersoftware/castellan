# Research applied to Castellan's design

Reviewed on 7 October 2026, with primary sources. We read the code of **When Agents Rule (WAR)** at [`d6319a2`](https://github.com/asp67/when-agents-rule/tree/d6319a2e00cb43797d044f748cca9fdbc10b0980), still its HEAD when we checked GitHub. An outside implementation shows that a technique exists. It does not show that its game has better balance. The blogs below are design arguments, not experimental results about Castellan.

## Implemented change: economy outside the base

In [maps.ts](../packages/shared/src/maps.ts) each seat keeps its 8 starting mines, now with 250 instead of 500. The other 2,000 go to 4 mines of 500 on 2 outer flanks. Central mines, total resources, map sizes and fortifications stay the same.

| Map | Total before and after | Mineral in starting sectors before → after | Outer mineral after |
| --- | ---: | ---: | ---: |
| open, fortress, ridge, canyons | 9,600 | 8,000 → 4,000 (83.3% → 41.7%) | 5,600 |
| fortress-quad | 21,600 | 16,000 → 8,000 (74.1% → 37.0%) | 13,600 |
| quad | 26,400 | 16,000 → 8,000 (60.6% → 30.3%) | 18,400 |

The "starting sector" is the local square `x < 13 && y < 13`: exactly the inside of a fortress. "Outer" includes the side expansions and the shared mines. **It does not mean all that mineral is equally contested**. `quad` also keeps its 2 earlier outer mines of 600 per seat.

The goal is one concrete decision: mine a flank while the player fights over the center, or attack the rival's transport. Moving all the mineral to the center would have created a single control point. The 8 starting mines keep their positions and access; with smaller reserves, they run out sooner.

**Verified:** [map-resources.test.ts](../packages/engine/test/map-resources.test.ts) checks all 6 maps for: total mineral, valid tiles that don't overlap rocks or buildings, equal path costs under rotation, rival access to every expansion without destroying walls, and replay of a historical layout embedded in the replay.

Replays store the whole map. They don't look up its name in `MAPS` again.

**Still to measure in matches:** first outer extraction, mineral delivered from outside, workers lost in transport, how long each flank stays under control, and the economic return of a second castle. A castle costs 600 and each new pair of mines holds 1,000. To justify it, its defense, its production or access to more than one pair may matter. Symmetry and access are tested. Whether it makes better matches is still a hypothesis. Compare it with the historical map using the same agents, seed and rules, with sides swapped. Don't credit the mines with effects that come from also changing the stats.

## What to take from When Agents Rule

| Evidence in WAR | Use in Castellan and the check it needs |
| --- | --- |
| [`wait` is an empty action](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L6349-L6351); the [driver starts new decisions](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L9648-L9663) based on time and availability. | Keep "hold the current orders" separate from "block a call". Without a blocking wait, **each connector** must deliver new observations on its own. Test an agent that decides to change nothing and then gets attacked: it must take back control without endless polling and without ending its process. The simulation keeps running during inference. |
| [Damage and losses add up per encounter](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/game.js#L2488-L2613), kept for up to 2 minutes. | Add a factual summary of fights since the last observation: damage, losses, place and time, even if no unit is left alive. Acceptance case: a fight starts and ends while the model thinks, and its next observation lets it rebuild what it lost. Don't derive an automatic tactical suggestion, and never reveal enemies it hasn't seen. |
| [It sorts orders into valid, avoidable, or affected by later changes](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L603-L651), using what the observation showed. | Record `observedAtTick`, `appliedAtTick` and a stable code for each rejection. Test separately a made-up ID and a visible target that dies during inference. Both rejections cost the player time; their explanation in an experiment differs. |
| [It shows costs and `blockedBy`](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/openai-ai.js#L3757-L3793). | Show availability derived from the real checks: mineral, population, queue and the requirements of that match's rules. The state already includes production. What's missing is sparing the agent from rebuilding every block itself. Don't keep references to unlocks removed in v21d; old replays may still have them. |
| [It compares full contracts by hashes](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/conditions.js#L56-L79). One unknown component blocks a claim of equivalence. | A manifest per seat: engine, rules/map, prompt, tools, model/effort, connector and memory. Visible player names don't replace that evidence. A rerun must state exactly what it kept and what it changed. Don't store keys or secret connection settings. |
| [Scenarios with a solution and a negative control](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/tests/bench-scenarios.test.cjs#L18-L34) are tested under rotations and mirrors. | Add small scenarios for a jam, production, defending a mine and a retreat. Require a reference to solve every side, and require standing still to fail. This checks that context and commands let the agent carry out the decision. Don't mix this signal with the balance score. |
| [Standing orders limit chases and return to the task](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/standing-orders.js#L21-L95). | Example script: defend workers, chase only within a radius and return to the post. Test that a single enemy doesn't drag away the whole defense. Castellan must keep the freedom to program this, without imposing all of WAR's automation. |

Its [resource generator](https://github.com/asp67/when-agents-rule/blob/d6319a2e00cb43797d044f748cca9fdbc10b0980/js/terrain.js#L171-L197) combines rotation with a target distance from the bases. To be precise: it makes up to 60 attempts, so that snippet alone **does not guarantee** the exclusion for every seed. Castellan has fixed maps: we can check every seat instead of assuming equality because the amounts match.

Castellan already remembers buildings and deposits seen between decisions (`Match.refreshVision` / vision memory). This is not a gap we found by comparing with WAR. The proposals in the table are future steps, except the ones already implemented and documented in code and tests.

## What the blogs change in our reasoning

### 1. One matchup doesn't show the full value of an option

[Sirlin, Viable Options](https://www.sirlin.net/articles/balancing-multiplayer-games-part-2-viable-options) separates global balance from equality in local situations, and suggests looking for answers and counter-answers. For Castellan this **doesn't force us to replace the optimizer's function**. It forces us to limit what we conclude from it.

Complementary experiment: the same budget in knight/archer, with and without room to fall back, against a tower and when attacking workers. Report survival, damage and goal reached per scenario, without averaging them into a new score. If one composition wins all of them, look for a dominant option. If it loses in the open but wins when breaking into a mine, that difference may be worth keeping. The identity of the 2 units is still a project decision.

### 2. Retreating is part of combat, not just moving back

[Casteel, Control of Tactical Outcomes](https://waywardstrategy.com/2016/02/17/rts-design-thought-control-of-tactical-outcomes/) separates composition, position, control during the fight and the ability to leave it. In Castellan the archer takes 400 ms per move and the knight 500 ms, and shooting needs aiming. Depending on obstacles, cooldowns and the script, this can allow kiting or make a retreat suicidal.

Experiment: repeat the same fight with a retreat at 70%, 40% and 20% HP, in open ground and in a narrow pass. Measure surviving mineral and time with abandoned mines. If retreating saves the army but gives up income, there is a real decision. If every retreat dies to blocked orders, fix the interface or the pathfinding first. Without this evidence, don't add invulnerability or a retreat button.

### 3. Generalist units can erase decisions

[Casteel, In Defense of Hard Counters](https://waywardstrategy.com/2021/07/27/hard-counters/) warns that a unit that is too efficient against everything can make composition and position irrelevant. The text doesn't show that Castellan needs damage by class or a third unit.

Experiment: pit armies of 100/0, 75/25, 50/50, 25/75 and 0/100 against each other with the same budgets, competent scripts and separate scenarios. Cross them with economic raids and defense. Only if the same composition always dominates, review which role is missing, and then its stats. "Mixing always wins" must not be an imposed goal either.

### 4. An expansion should offer a benefit and a vulnerability you can choose

[Casteel, Progression and Equilibrium](https://waywardstrategy.com/2017/03/03/the-balance-of-power-progression-and-equilibrium-in-real-time-strategy-games/) looks at how military, income and production losses reinforce each other. In Castellan a castle combines defense, drop-off and production. Losing it can hurt all 3 at once.

Already applied: outer resources in several places. Pending experiment: compare investing first in workers, in army or in an outer castle. Then repeat while losing an expansion. Measure net income, time to recover production and the chance to switch flanks. If the first economic winner controls all later income, cutting the safe resources could **make** the snowball effect worse. More early combat alone doesn't make the change a success. This hypothesis doesn't change victory, the draw condition or unit costs.

## Criteria for the next iteration

1. Pass the engine/context tests and the executable references.
2. Run the comparison between the old and the new map with sides swapped, and record their manifests.
3. Choose with the validation results. Check a reserved final test set only once.

The model's real latency is part of the competition; we record it to explain results. These sources guide **what to measure and which alternatives to try**. They don't replace testing our rules.
