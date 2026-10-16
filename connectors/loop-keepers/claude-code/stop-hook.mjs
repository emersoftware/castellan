import { seat } from "../game.mjs";

try {
  const observation = await seat().observation();
  if (!/ · finished · /.test(observation) && !/^YOU\s+.* · OUT$/m.test(observation)) {
    console.log(JSON.stringify({ decision: "block", reason: `Next decision. Current observation:\n${observation}` }));
  }
} catch { /* A dead server must not trap the session. */ }
