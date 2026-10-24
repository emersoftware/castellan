// The next turn in the same conversation, built and timed like every other keeper's:
// only while the match runs, and no sooner than MIN_INTERVAL_MS after the previous turn.
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { observedSeat, seat, seatOver } from "../game.mjs";
import { MIN_INTERVAL_MS, turnFor } from "../turns.mjs";
import { reportActivity } from "../metadata.mjs";

const maxReadFailures = 3;
const retryMs = 1000;
const game = seat();
let readFailures = 0;
const stamp = ".castellan-last-turn"; // in the player's private working directory
try {
  const since = Date.now() - (Number(await readFile(stamp, "utf8").catch(() => "0")) || 0);
  if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
  for (;;) {
    let observation;
    try {
      observation = await game.observation();
      readFailures = 0;
    } catch (error) {
      const status = error?.status;
      console.error(`castellan claude-code: observation failed${Number.isInteger(status) && status > 0 ? ` (HTTP ${status})` : ""}.`);
      if (status === 401 || status === 403 || ++readFailures >= maxReadFailures) throw error;
      await reportActivity("connector_retry", { retryAt: new Date(Date.now() + retryMs).toISOString() });
      await sleep(retryMs);
      continue;
    }
    if (seatOver(observedSeat(observation))) break;
    const turn = turnFor(observation, { delivered: true, prompt: "" });
    if (turn) {
      await writeFile(stamp, String(Date.now()));
      console.log(JSON.stringify({ decision: "block", reason: turn }));
      break;
    }
    await sleep(1000);
  }
} catch {
  // Claude may exit successfully after a hook fails. The launcher must preserve this failure.
  await writeFile(".castellan-hook-failed", "The next observation could not be delivered.\n");
  await reportActivity("stopped");
  console.error("castellan claude-code: Stop hook failed; ending this seat without restarting it.");
  process.exitCode = 1;
}
