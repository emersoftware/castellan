# Wizard: healing, hacking and conversion

Status: implemented in rules 0.30.0: shared rules and guide, engine, sandbox,
server and MCP; the Wizard's runtime art and viewer presentation are registered
in the web client. Tests, typecheck, build and fresh rendered checks passed on
2026-10-23. Values are approved for testing, not measured balance.
"Implemented behaviour" below is the contract. The design record that follows
preserves the earlier proposal; where they differ, the contract wins. The final
validation section records the checks actually completed.

## Confirmed gameplay

- Initial test values: 200 mineral, 45 HP and 0 defence. These are approved for
  testing, not established combat balance.
- `self.heal(target)` continuously heals one selected friendly unit at 6 HP per
  second, including teammates and Kings, with range 3. It cannot heal itself or
  buildings. The rate is approved for testing and can change after measurement.
- One research, Intrusion, costs 300 mineral and takes 20 seconds. It unlocks
  both `self.hack(target, code)` and `self.convert(target)` for units.
- Hacking replaces only the selected entity's script with player-written code.
  It preserves owner and team. Behaviour can include moving in circles,
  abandoning defence or attacking a third player in FFA. There is no fixed
  catalog of sabotage effects.
- Conversion is a separate action that changes the target's owner to the
  Wizard's player. Injected code cannot change ownership itself.
- Conversion removes any previous hypno intervention and applies the new
  owner's normal script and upgrades. Preserve remaining HP, capped at the new
  maximum if necessary, rather than healing the converted unit.
- Conversion can exceed the population cap. Training cannot add units until
  population is below the cap again; conversion does not discard captured units.
- Kings are immune to both actions. Other unit kinds, including Wizards, are
  eligible.
- A second research costs 400 mineral and takes 30 seconds, after Intrusion.
  It enables hacking adjacent buildings. Buildings cannot be converted.
- Initial offensive range against units is 7 tiles, with Wizard vision 8.
  Both offensive actions use a variable 3–7-second channel inspired by AoE II
  monks. They share a 20-second recharge starting on successful completion.
  Healing and movement remain available during recharge. The probability
  distribution within the approved window is still provisional.
- An injected script persists until a Wizard overwrites it. Ordinary script
  uploads do not cleanse it. Recovering a unit uses the same hack action to
  install its owner's code; there is no separate cleansing action.
- While hypno is active, the original owner cannot issue manual orders to the
  entity. Existing manual orders must not override the injected behaviour.
- The script controller always identifies its `hypno` entities. The original
  owner also sees that they are compromised, without a signature, rune or
  identifying trace. The warning does not disclose the hacker's identity.
- A hypno unit shares its own local sight with its script controller. This does
  not grant the controller the rest of its owner's private map visibility.
- The default script prioritizes a wounded ally in healing range; otherwise it
  attempts to convert a suitable nearby enemy when able. A healthy nearby ally
  must not block conversion.

## Implemented behaviour

Numbers live in `packages/shared/src/rules.ts` (`kinds.wizard`, `upgrades.intrusion`);
behaviour comes from the `heals` and `intrusion` capabilities, never the kind's name.

- **Unit:** Castle, 200 mineral, 12 s, one population, 45 HP, 0 defence, vision 8,
  500 ms per straight tile, no attack. Symbol `Z`/`z`.
- **Research:** one upgrade, `intrusion`, two levels bought in order: L1 (300, 20 s)
  hack and convert units; L2 (400, 30 s) also hack buildings at range 1.
- **Who acts:** a hack changes who decides, not sides. Every entity fights, heals,
  hacks and converts for its owner, with its owner's research; the player whose
  script decides for it (under hypno, its controller) supplies its VM, gas and the
  sight it acts on. A hypno Wizard keeps every ability, and a conversion it
  completes goes to its owner. Its economic owner stays until a conversion.
- **Heal** (`heal(u)`, order `heal`): a unit that is not hostile to that player,
  never itself or a building; Kings included. 6 HP/s as whole points by elapsed
  time (`floor((n+1)·6/rate) − floor(n·6/rate)` on the n-th consecutive tick),
  capped at max HP, applied after the tick's deaths. Healers stack. Out of range a
  mobile healer walks toward the target. Any other action resets the streak.
- **Eligibility:** vital kinds (the King) are immune; ruins and neutral walls are
  inert. Convert: enemy units only, never buildings. Hack: enemy units (L1) or enemy
  buildings of every kind, walls and doors included (L2); or the player's own
  entity while it runs an installed script (recovery). Own units without one and
  allies' entities are refused.
- **Channel:** range 7 to units, 1 to buildings. Duration rolls `chance` 0.38 once
  per second from the minimum (3 s units, 6 s buildings) and is certain at the
  maximum (7 s, 10 s). Each roll hashes the match seed, caster, target, start tick
  and second (FNV-1a with an avalanche), so no random stream depends on event
  order. Only ticks in range count; out of range a mobile caster pursues a visible
  target and keeps its progress. The same action at the same target continues it;
  anything else — another action, hold, any accepted manual order other than the
  same ability at the same target, the target leaving sight, the caster's death or
  change of control — cancels it. Damage does not cancel.
- **Payload:** a hack's code (≤ 4096 bytes) is compiled once when its channel
  starts, as a named script in the deciding player's VM, and frozen; repeating the
  hack with other code continues with the frozen one. A cancelled or refused
  channel removes it from the VM that compiled it. The server also compile-checks
  `hack` orders on `/act`; a failure is answered at once without queueing the order
  and counts among the player's rejected orders (`Room.act` refusals).
- **Completion:** after deaths, in tick priority order. The target is checked again
  (and that the caster's controller is unchanged); one successful effect per
  target per tick, later completions fail without recharge. Success starts the
  shared 20 s recharge; moving and healing stay available. Recharge is kept across
  conversion and hack.
- **Hack:** the target keeps owner, team and colour and runs the payload in the
  controller's VM, with the controller's gas and sight. Its enemies and allies stay
  its owner's, in combat and in its script view (`ownerSide`), so it cannot strike
  its owner's side; its projectiles hit its owner's enemies. Its kills credit the
  controller, while `death.by` names only its owner. Its owner's orders and the owner's per-kind
  uploads do not reach it; its current order ends (`hypno`), as do the owner's train
  orders at a hacked Castle, whose paid queue still delivers to the owner. A hacked
  wall or door runs the code with only what its kind can do (hold, log). A hacked
  worker gathers from deposits its controller knows and unloads at an owner Castle
  its controller sees; the mineral goes to its owner.
- **Recovery:** the owner's Wizard hacks its own entity. Empty code returns it to the
  owner's kind script; other code installs that code under the owner's control (no
  hypno; the owner may order it again). Overwrite: any other hack replaces the
  payload and controller.
- **Convert:** the unit changes owner to the Wizard's owner, drops any payload,
  ends its order (`converted`), takes the new owner's research and kind script,
  keeps HP (capped), carried mineral and cooldowns. The population cap may be
  exceeded; a trained unit then waits in its queue until the owner is below the cap.
- **Memory:** every change of owner or controller lists the entity in
  `ScriptWorld.forget`, so each VM that ran it starts over; no VM reads another's.
- **Controller loss:** when a controller is eliminated its payloads are released;
  an eliminated owner's hacked buildings become plain ruins.
- **Observation:** the controller receives the hypno entity's own vision footprint
  only. `EntityView.hypno` reaches the owner, the controller and observers;
  `controller` only the controller and observers. The entity's `doing` and
  `actionResult` (which can contain payload error text) reach whoever runs its
  script, not the owner. Script objects carry `hypno`/`controlled` the same way, and
  `vital` in rules with Wizards. `casting {action, target}` is public in sight like
  gathering; `progressMs` and `rechargeMs` are private. The `hypno` event reaches the
  owner and the controllers involved; `controller` and `wizard` are stripped for
  everyone but that controller, also in observer perspectives. Payload errors and
  logs are the controller's events and are not stored as its per-kind errors.
- **Replays:** hack code travels in recorded orders or comes from recorded scripts;
  re-simulation repeats it. Rules without `heals`/`intrusion` add nothing to the
  state hash, so earlier recordings keep their hashes.

## Channel interpretation (design record)

The proposed monk-like interpretation is that damage alone does not cancel a
channel, while death or an explicit movement/change-of-action order does.
Automatic pursuit outside range preserves accumulated progress while the target
remains visible. Visibility loss, retargeting and failed attempts need precise
rules before code. Reissuing the same action from a script must not reset its
progress every tick.

Multiple casters and same-tick completions need deterministic resolution.
Recheck target ownership, controller and eligibility at completion. A dead
Wizard or target cannot complete a successful effect.

## Candidate numbers and arithmetic

The 200 mineral cost, 45 HP, 0 defence, 6 HP/second healing, range-3 healing,
range-7 offensive actions against units, vision 8, adjacent building hacking,
3–7-second unit channel, shared 20-second recharge and research prices/times
are approved initial test values. Other values below are candidates. These are
not current runtime rules or measured combat balance. Training time and movement
remain open.

| Property | Candidate |
| --- | --- |
| Training | Castle, 200 mineral, 12 seconds, one population |
| Durability | 45 HP, 0 defence |
| Movement / vision | 500 ms per straight tile (candidate) / 8 tiles (approved) |
| Direct damage | None |
| Healing | 6 HP/second, range 3 |
| First research | 300 mineral, 20 seconds (approved for testing) |
| Unit channel / range | 3–7 seconds / 7 tiles (approved for testing) |
| Building range | Adjacent |
| Building research | 400 mineral, 30 seconds, requires Intrusion (approved for testing) |
| Building channel | Open |

For the arithmetic example only, roll once each second at seconds 3 through 6
with probability 0.38, then guarantee completion at second 7. The mean channel
is 4.39049136 seconds. Use recorded deterministic simulation randomness when
implemented, not wall-clock time or external services.

With uninterrupted targets, sustained captures per minute are
`60 / (mean channel + recharge)`:

| Recharge | Captures/minute per Wizard |
| --- | --- |
| 15 seconds | 3.0943 |
| 20 seconds | 2.4600 |
| 25 seconds | 2.0415 |
| 30 seconds | 1.7447 |

Current knights and archers cost 100 mineral each. Converting a healthy one
changes relative army acquisition value by roughly 200: one side loses 100 and
the other gains 100. This is not mineral income. With the approved 200-cost
Wizard and 300-cost research, three captures exceed that 500
investment in this comparison. Starting with research complete and a ready
Wizard, the mean time to the third uninterrupted capture is
`3 * 4.39049136 + 2 * 20`, or 53.17 seconds.
Travel, healing, interruptions, damage and deaths reduce the ideal capacity.
Hacking without conversion has different value and needs separate scenarios.

### Ranged-pressure probe

A local engine probe used current rules v0.29.3, seed 1 and 10 Hz, with an
immobile worker proxy changed to 45 HP/0 defence and no attack or script. A
single archer received an explicit attack order from the stated distance.
No blockers, healing or other combatants intervened. A second pass applied
the existing archer range research. All match resources were disposed.
This measures current damage/movement/projectiles, not a Wizard channel or
an implemented hack/convert action.

| Starting distance | Proxy death: archer range 5 | Proxy death: upgraded range 6 |
| --- | --- | --- |
| 5 | 3.3 seconds | 3.3 seconds |
| 6 | 3.7 seconds | 3.4 seconds |
| 7 | 4.1 seconds | 3.8 seconds |

Thus range 7 alone does not permit a solo conversion with a 5-second minimum
against an archer that immediately attacks. It can help a protected support
Wizard start earlier. The resulting approved initial configuration is range 7,
vision 8 and a 3–7-second channel. Under the provisional 38%-per-second model,
completion before those observed death times would have probability 61.56%
against the base archer and 38% against the range-upgraded archer. These are
arithmetic estimates assuming channel start at time zero; same-tick ordering,
visibility, interruptions and actual conversion effects remain untested.
The range, vision and timing window are approved for testing; the probability
model and resulting combat effectiveness still require validation.

## Ownership, script control and observations

Keep economic/team ownership distinct from the injected-script controller.
During hacking, preserve the owner's base colour. The controller sees a
`HYPNO` marker, owner/controller details, a count and a selectable group.
The original owner sees a generic compromise warning without a signature,
rune or hacker identity. Whether third parties see the generic warning remains
open. Show successful interventions only after confirmed state/events, never
from submitted orders alone. Keep controller identity private in affected-owner
observations as well as in the visual marker.

Recovery must allow a Wizard to target an owned but compromised entity.
Per-kind uploads may update underlying code but cannot remove the intervention.

On conversion, remove the intervention and use the new owner's normal script
and researched stats for that kind. Preserve remaining HP, capped at its new
maximum. Conversion may exceed the population cap; training must recheck
available capacity at completion, including work queued before a conversion.
Memory, carried resources, production queues and research-gated capability
transitions need decisions before implementation. Building conversion is
always rejected.

Full behavioural control includes targeting beyond normal team restrictions;
implement that as an explicit rule for compromised entities, without exposing
arbitrary ownership or entity mutation. Hypno units contribute their own local
sight to the controller's observation. Keep the target's owner's wider private
observation and other units' memory isolated. Reject original-owner manual
orders while hypno is active, and prevent pre-existing manual orders from
overriding the injected script. Decide whose resources building orders spend
and how recovery handles contested channels. The exact script execution view
must follow the chosen controller/ownership contract without leaking the owner's
global view.

## Implementation sequence and package ownership

Design record: the sequence proposed before implementation. Each step is now
implemented; "Implemented behaviour" describes the result.

1. **Art:** the faceless pointed hood flows into a simple robe, without beard,
   hair, embroidery or layered costume. Static poses and
   [MiniMax atlases](../assets/animations/wizard/README.md) cover idle, walk,
   heal, hack and death, eight directions, 28 frames at 12 fps and four engine
   palettes. (Since registered in the web client's runtime assets.)
2. **Shared:** add Wizard and healing/hacking/conversion capabilities, research,
   orders, target/controller metadata, activities, recharge and result events.
   Keep numbers in `packages/shared/src/rules.ts`; update guide and text views,
   and regenerate `docs/CURRENT-RULES.md` after settling the design.
3. **Sandbox:** current scripts are selected per player and kind through
   `UnitScripts.setScript` and the sandbox. Add a per-entity override behind
   the script host interface, instead of replacing every entity of that kind.
   Add the three action APIs and capped payload memory. Compare runtime
   placement and gas attribution against the owner/controller observation
   contract before choosing where code executes. Preserve QuickJS isolation,
   budgets, diagnostics and the worker lifecycle.
4. **Engine:** compose ability resolution with movement, combat, visibility
   and scripts. Own target validation, channels, pursuit, shared recharge,
   replacement, recovery and conversion here. Healing caps HP without revival.
   Propose completing interventions after same-tick deaths and starting the
   replacement script next tick. Hash channels, RNG state, controllers,
   payload identifiers and memory.
5. **Server and clients:** validate and freeze source before channeling; reuse
   existing script limits and transformation boundaries. Carry source through
   orders, workers, checkpoints and replays. Define controller authorization
   independently of ownership. Preserve the same API across connectors,
   private observations and spectator authorization.
6. **Viewer:** register runtime art, portraits and labels. Face the target and
   show confirmed channels/recharge. Distinguish ownership from `hypno`
   control. Support pause, seek, speed and controller-filtered selection,
   without disclosing private payload source.

Old recordings have no Wizard capability. Preserve their original simulation,
hashes and outcomes. New recordings must contain enough source and ownership/
controller changes to reproduce interventions without unrelated observations.

## Verification after implementation

- Engine fixtures: healing and Kings, offensive immunity, both research gates,
  shared recharge, variable channels, pursuit, deaths, competing casters,
  persistent intervention, recovery and explicit conversion.
- Check a single target among identical units, own-team and FFA targeting,
  original-owner orders, controller visibility, population and resource
  accounting. Building conversion fails even after building research.
- Sandbox fixtures: invalid/oversized code, loops, gas limits, memory/global
  isolation, replacement, disposal and controller changes.
- Server/worker checks: authorization, source privacy, compilation parity,
  checkpoint recovery, operational failure and worker cleanup.
- Strict replay checks: an unchanged historical fixture and a new fixture
  exercising both actions, recovery and deterministic random timing.
- Fresh rendered gameplay checks: directions, palettes, owner colours,
  `hypno` visibility, channels, confirmed success and replay seeking.
- Run `pnpm test`, `pnpm typecheck` and `pnpm build` after integration,
  including unused code, lint and copy checks. Balance tests use controlled
  local scripts; the arithmetic above does not establish combat balance.

## Validation completed on 2026-10-23

- `pnpm test`: 705 tests in 117 files passed, including unused-code, lint,
  copy and generated-guide checks. `pnpm typecheck`, `pnpm build` and
  `git diff --check` also passed.
- A 900-tick local fixture exercised gradual healing, unit hacking, conversion,
  recovery and building hacking. Strict replay verification passed. Fresh Chrome
  captures of the built client showed the engine dithering, casting gestures,
  tethers and HYPNO at zoom levels 1 and 3, including an anonymous owner view.
- Viewer refinement, 2026-10-24: no field text. A hack shows a turning spiral, in
  the controller's colour only where the view names it; confirmed effects ring the
  target on the ground. Motes leave the staff crystal tracked per frame, sorted by
  depth, and burst with the new heal clip's reviewed flares, as do the MOSS sound
  effects. The Wizard displays at 0.92 of its export and its SW-facing SE row is
  mirrored for SE. New hack (staff thrust) and convert (staff raised) clips followed,
  with their own reviewed flares; convert no longer borrows the hack gesture.
- The hidden-dropoff regression was demonstrated in an isolated source copy:
  removing the controller-visibility filter makes the worker reveal a hidden
  Castle and fails the privacy test. The corrected implementation passes.
- Two requested model matches used `gpt-6.1-sol`, Codex CLI 0.163.0, fresh isolated
  sessions and the same starting prompt within each match. Their recorded model
  and effort metadata, hashes and equivalent archive copies were verified;
  neither recording contains a sandbox operational failure or script error.
  Duel `06e885c4` (seed 2026102301): medium defeated low in 323.4 seconds.
  FFA `9f830818` (seed 2026102302): xhigh won in 491 seconds; medium, low and high
  lost their Kings in that order.
- The duel had two Wizards in total (one at a time); the FFA had ten (at most
  four at once). All six players used healing. The FFA recorded a conversion
  attempt, but neither model match completed a hack or conversion. The local
  fixture and regression tests cover those successful effects; these two
  matches do not establish their balance.
- Evidence, captures and private model-run logs are under
  `~/.local/share/castellan/reports/wizard-implementation-20261023/`.
  No commit, push, deployment or public replay publication was performed.

## Open after implementation

- Balance: every number is an approved test value. Measure with controlled local
  scripts and recorded matches before changing them.
