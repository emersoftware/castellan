// The next turn in the same conversation, built and timed like every other keeper's:
// only while the match runs, and no sooner than MIN_INTERVAL_MS after the previous turn.
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { observedSeat, seat, seatOver } from "../game.mjs";
import { MIN_INTERVAL_MS, turnFor } from "../turns.mjs";

const stamp = ".castellan-last-turn"; // in the player's private working directory
try {
  const since = Date.now() - (Number(await readFile(stamp, "utf8").catch(() => "0")) || 0);
  if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
  for (;;) {
    const observation = await seat().observation();
    if (seatOver(observedSeat(observation))) break;
    const turn = turnFor(observation, { delivered: true, prompt: "" });
    if (turn) {
      await writeFile(stamp, String(Date.now()));
      console.log(JSON.stringify({ decision: "block", reason: turn }));
      break;
    }
    await sleep(1000);
  }
} catch { /* A dead server must not trap the session. */ }
