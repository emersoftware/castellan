# Castellan — evidence

All matches below were played by the player in `connectors/castellan` with its own token only.
Real-time rooms ran on the local server (`http://localhost:4400`, rules `v21d-no-unlocks`,
10 ticks/s); each has a public replay at `http://localhost:5173/replay/<room>` once finished and
a journal + summary under `evidence/<name>/`. Headless benchmarks run the same core against the
reference bots through the engine (no server, no real time; `pnpm --filter @aoa/castellan bench`).

## Real-time rooms

| name | map | seats | result | time | replay | notes |
|---|---|---|---|---|---|---|
| A1-open-rush | open | castellan vs rush | **win** (king) | 4:04 | /replay/3a3bdabb | 19 knights + 7 workers killed, 7 knights lost, 1 rejected order of 59 |
| A2-open-eco | open | castellan vs eco | loss (king) | 4:07 | /replay/7d650f3f | keep left with a hole: a wall site rejected as occupied by my own builder (fixed afterwards) |
| A3-open-turtle | open | castellan vs turtle | **win** (king) | 9:33 | /replay/8331c5d1 | see summary: expansion, keep and towers |
| A4-open-kite | open | castellan vs kite | loss (king) | 3:48 | /replay/c7dc3b23 | eight kiting archers; no tower stood in time (mineral rule fixed afterwards) |
| D1-open-turtle | open | castellan vs turtle | draw | 10:00 | /replay/9b134c37 | expansion castle, 3 towers and keep built; two attacks retreated outnumbered |
| C1-quad-teams | quad | castellan+castellan vs eco+rush | loss (both kings) | 3:41 | /replay/afdfa1a8 | eco and rush both struck the same ally; team messages (plans, attack, help) exchanged, but no combined defence in time |
| C2-quad-ffa | quad | 4 castellans | draw (4 kings alive) | 15:00 | /replay/bfe2f5b5 | truces proposed and accepted by private chat at 0:06–0:14, 6–7 messages per player; after minute 5 three attacks on (39,4), truces marked broken, endgame `hold` |

The server measured every player the same way (`timing` in the room summary): the loop kept
observation age at 0–1 ticks, with at most 38 ms of thinking per cycle.

Two more rooms of the same evening (`/replay/0144fa37`, a win against eco at 9:33, and
`/replay/ec322e99`, a draw against turtle) were played by an earlier build that could hand a few
strategic choices to a model; that feature was removed afterwards at the user's request, so they
are not evidence for the delivered player.

## Headless benchmarks (engine, one decision per second, final code)

Seed 100, castellan on seat 0. The bots are deterministic, so one game per pairing is
representative; `pnpm --filter @aoa/castellan bench --n 2` flips sides.

| map | opponent | result | time | what happened |
|---|---|---|---|---|
| open | rush | **win** | 5:00 | 22 knights + 6 workers killed, 8 knights lost; attack after repelling the stream |
| open | eco | draw | 10:00 | keep + tower built; 35 knights killed for 8 knights, 3 archers, 5 workers; never a window to take the enemy king |
| open | turtle | **win** | 9:00 | expansion castle, two towers and the keep built; 16 knights, a tower and 13 workers killed |
| open | archers | **win** | 5:06 | 21 archers and 13 workers killed |
| open | kite | loss | 3:24 | eight kiting archers; the knights are kited and the castle falls (known weakness) |
| fortress | eco | **win** / draw | 7:36 / 10:00 | archers inside the wall line shoot the besiegers (26 kills for 2 losses); an attack can stall at the enemy walls (breach logic revised afterwards) |
| fortress | turtle | draw | 10:00 | 15-unit army, keep built, expansion planned behind the walls |
| quad ffa | 4 castellans | draw | 10:00 | every truce agreed by chat; three players expand and build keeps; one is overrun once truces expire |
| quad teams | 2 castellans vs eco+rush | loss | ~4:00 | both allies attacked the same corner at 1:43; team messages exchanged |

Earlier versions of the same evening were measured in the same way; the numbers above are from the
code as delivered. Logs of the bench runs: `/tmp/castellan-bench-*.txt` on the machine that ran them.
