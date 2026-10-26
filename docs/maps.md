# Six-player maps

`hex` and `fortress-hex` are square 64×64 maps for six independent players,
exclusively FFA. They share starting positions, units and mineral deposits.
`hex` is open, with no prebuilt walls or doors. `fortress-hex` adds fortifications.

Two bases touch the north boundary, two the south, and one each the east and
west. Every camp occupies 13×13 tiles with a Castle, a King and three Workers.
In `fortress-hex`, three owned, destructible wall lines (34 walls and three doors, one centered on
each line) enclose it; the map boundary closes the fourth side. No door faces
off the map. The host shuffles seats using the match seed.

| Seat | Castle center | Boundary | Clockwise quarter-turns |
| --- | --- | --- | ---: |
| 1 | (6,32) | west | 3 |
| 2 | (16,6) | north | 0 |
| 3 | (47,6) | north | 0 |
| 4 | (57,31) | east | 1 |
| 5 | (47,57) | south | 2 |
| 6 | (16,57) | south | 2 |

## Distances

The 64×64 requirement describes the whole map, not a travel distance.
Neighbouring Castle centers are 26.9–31 tiles apart. The farthest pair is
59.7 tiles apart. Opposite pairs range from 51.0 to 59.7. The camp centers and
shared mines have 180-degree symmetry, but six camps along four edges cannot
have identical distances in every direction. Seats on the left and right have
a shorter approach to the center than the four on the top and bottom.

The following routes are for `fortress-hex`, measured with the real pathfinder and all initial buildings/mines as obstacles,
ignoring mobile units and combat. An unupgraded Knight at 10 ticks/s takes four
ticks straight and six diagonally, after rounding:

| Starting seat | Adjacent to next fortress's nearest door | Adjacent to previous fortress's nearest door | Central 2×2 tiles |
| --- | ---: | ---: | ---: |
| 1 | 9.6 s | 9.2 s | 10.0 s |
| 2 | 10.0 s | 9.4 s | 13.0 s |
| 3 | 9.0 s | 10.0 s | 13.0 s |
| 4 | 9.6 s | 9.2 s | 10.0 s |
| 5 | 10.0 s | 9.4 s | 13.0 s |
| 6 | 9.0 s | 10.0 s | 13.0 s |

These costs start at the Castle center as a geometric reference; units spawn
beside it. Only the starting owner's doors are passable. Enemy door destinations
use the engine's rounded range 1, so the arrival tile can be diagonal. Intact
enemy fortresses cannot be entered; breaching time is excluded. These are path
costs, not predictions of battle arrival. Other speeds, research, congestion and
enemy movement can change travel times. Strategic balance has not been measured.
Walls do not block sight or archer shots flying over them.

## Economy and map contract

Both maps give every seat the same rotated camp and personal mining layout:
four home mines of 100 (400 total, down from 1,200) and four expansions of 900
(3,600). On `fortress-hex`, the home mines are inside the walls;
two expansions sit beyond the side gates and two flank the front
gate's approach. The omitted back expansion would fall outside the map.
All three exits have room to move beside the mines. Six shared deposits of 600
sit between neighbours; six of 800 surround the center. Total mineral stays
32,400, or 5,400 per seat including the shared pool. Personal mining path costs
are identical; all expansions and shared mines are reachable by every opponent.

`MapSpec.origins` rotates the local `start` and `deposits` by each origin's
clockwise `rotation` (0–3 quarter-turns), then translates them. Omitted rotation
means zero, preserving older translated layouts. Six seats require six integer
origins. The engine validates rotations, seats, tile bounds and overlaps before
allocating script VMs. Movement direction and reading-order tie breaks use the
same local orientation. Maps without origins retain historical corner transforms.
Replays embed all map data, including starts, mines and origin rotations; they
never look up today's map by name. Earlier recordings stay unchanged, including
both the old 85×85 open `hex` and the 64×64 fortified version previously named `hex`.

The six-seat lobby supports FFA only, with six distinct randomized or fixed seats.
Each seat owns its own script engine and fog. The last surviving King wins; the
time limit is 15 minutes (the existing `fourSeatMatchMs` wire field also applies
to six-seat maps). No unit stats, budgets or watchdog limits change.

Regression coverage lives in engine `six-player.test.ts` and
`map-resources.test.ts`, server `six-player-ffa.test.ts`, and the renderer's
mineral-capacity test. Paid model comparisons remain separate experiments.
