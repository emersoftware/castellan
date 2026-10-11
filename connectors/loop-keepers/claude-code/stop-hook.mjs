const server = process.env.AOA_SERVER || "http://localhost:4400";
try {
  const res = await fetch(`${server}/state?format=text`, {
    headers: { authorization: `Bearer ${process.env.AOA_TOKEN}` }, signal: AbortSignal.timeout(8000),
  });
  if (res.ok) {
    const observation = await res.text();
    if (!/ · finished · /.test(observation) && !/^YOU\s+.* · OUT$/m.test(observation)) {
      console.log(JSON.stringify({ decision: "block", reason: `Next decision. Current observation:\n${observation}` }));
    }
  }
} catch { /* A dead server must not trap the session. */ }
