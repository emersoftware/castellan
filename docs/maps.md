# Six-player map

`hex` is an 85×69 open map for six independent players. Each starts with a
Castle, a King and three Workers. There are no prebuilt fortifications. Base
centers, clockwise, are (10,34), (26,10), (58,10), (74,34), (58,58), (26,58).
The center is (42,34). The host shuffles seats using the match seed.

## Distances

Scaling the four-player map's area by 6/4 would give about 54×54, but area alone
does not preserve travel time. A two-row grid gives middle players three close
neighbours and corner players two. The ring gives everyone two close neighbours.

The ring is adjusted for the engine's grid instead of using a regular Euclidean
hexagon. At 10 ticks/s, an unupgraded Knight takes four ticks straight and six
diagonally, after rounding. Both neighbour offsets (32,0) and (16,24) cost 128
ticks on unobstructed ground. Every base has one of these offsets to the center
as well. The four-player fortress's adjacent Castle centers are 35 tiles apart,
or 140 ticks in an unobstructed straight line.

Measured with the real pathfinder and all initial buildings/mines as obstacles,
ignoring mobile units and combat:

| Starting seat | Adjacent to next Castle | Adjacent to previous Castle | Exact center tile |
| --- | ---: | ---: | ---: |
| 1 | 12.2 s | 12.2 s | 13.2 s |
| 2 | 12.6 s | 12.2 s | 12.8 s |
| 3 | 12.2 s | 12.6 s | 12.8 s |
| 4 | 12.2 s | 12.2 s | 13.2 s |
| 5 | 12.6 s | 12.2 s | 12.8 s |
| 6 | 12.2 s | 12.6 s | 12.8 s |

These costs start at the Castle center as a geometric reference; units spawn
beside it. Castle destinations use the engine's rounded range 1, so the arrival
tile can be diagonal. They are path costs, not predictions of battle arrival.
Other speeds, research, congestion and enemy movement can change travel times.
A square grid cannot have exact 60-degree rotational symmetry; this layout is
not a claim of measured strategic balance. The largest measured difference
between the corresponding initial routes above is 0.4 seconds.

## Economy and map contract

Every seat gets the identical translated camp and personal mines: eight home
deposits of 150 (1,200) and four expansions of 700 (2,800). Six shared deposits
of 600 sit between neighbours; six of 800 surround the center. Total mineral:
32,400, or 5,400 per seat including the shared pool, matching fortress-quad's
per-seat total. Personal mining paths have identical costs; all expansions and
shared mines remain reachable by every opponent.

`MapSpec.origins` translates the common local `start` and `deposits` layout
without rotation. Six seats require six integer origins. The engine rejects
invalid seats, out-of-bounds tiles and overlaps before allocating script VMs.
Movement direction and reading-order tie breaks use the common local orientation.
Maps without origins retain their historical corner transformations and ordering.
Replays embed origins and mine coordinates; they do not look up today's map by name.

The six-seat lobby supports FFA only, with six distinct randomized or fixed seats.
Each seat owns its own script engine and fog. The last surviving King wins; the
time limit is 15 minutes (the existing `fourSeatMatchMs` wire field also applies
to six-seat maps). No unit stats, budgets or watchdog limits change.

Regression coverage lives in engine `six-player.test.ts` and
`map-resources.test.ts`, server `six-player-ffa.test.ts`, and the renderer's
mineral-capacity test. Paid model comparisons remain separate experiments.
