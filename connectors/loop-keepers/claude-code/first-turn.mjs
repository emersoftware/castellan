// The first message for `claude -p`, built and timed like every other keeper's:
// it waits until the room reaches prep, then prints the shared first turn.
// Exits 3 when the seat is already over, so play.sh does not start a session.
import { setTimeout as sleep } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { observedSeat, seat, seatOver } from "../game.mjs";
import { promptOf, turnFor } from "../turns.mjs";

const game = seat();
for (;;) {
  const observation = await game.observation();
  if (seatOver(observedSeat(observation))) process.exit(3);
  const turn = turnFor(observation, { delivered: false, prompt: promptOf(), resumed: Boolean(process.env.AOA_RESUME) });
  if (turn) {
    // The Stop hook paces later turns from this moment (see stop-hook.mjs).
    await writeFile(".aoa-last-turn", String(Date.now()));
    process.stdout.write(turn);
    break;
  }
  await sleep(1000);
}
