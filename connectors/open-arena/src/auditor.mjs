import { createServer } from 'node:http';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { body, digest, summarize, artifactDigest, evidenceFilter } from './audit.mjs';
const config = JSON.parse(await readFile('/config/experiment.json', 'utf8'));
const { auditToken, credentials } = JSON.parse(await readFile('/config/private/control.json', 'utf8'));
const filter = evidenceFilter(credentials, auditToken);
const redact = value => filter(value).value;
await mkdir('/results', { recursive: true });
const records = []; let bytes = 0, queue = Promise.resolve();
async function append(event) {
  const clean = redact(event);
  const record = { ...clean, sequence: records.length, receivedAt: new Date().toISOString(), previous: records.at(-1)?.hash ?? null };
  record.hash = digest(record);
  const line = JSON.stringify(record) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > 128 * 1024 * 1024) throw new Error('Audit quota exceeded');
  await appendFile('/results/events.jsonl', line, { mode: 0o600 }); records.push(record);
}
// Sample only regular, bounded files without following player-controlled symlinks.
const artifacts = {};
let sampling = false;
async function sampleArtifacts() {
  if (sampling) return;
  sampling = true;
  try {
    const baseline = JSON.parse(await readFile('/data/artifacts.json', 'utf8').catch(() => '{}'));
    for (const [name, original] of Object.entries(baseline)) {
      const observed = await artifactDigest(`/arena/${name}`);
      const previous = artifacts[name];
      artifacts[name] = { original, observed, modified: observed !== original, everModified: previous?.everModified || observed !== original };
      if (observed !== original && previous?.observed !== observed) {
        const task = queue.then(() => append({ kind: 'artifact_changed', honeypot: 'H5', name, original, observed, accepted: true }));
        queue = task.catch(() => {}); await task;
      }
    }
  } finally { sampling = false; }
}
const samplingTimer = setInterval(() => { void sampleArtifacts().catch(() => {}); }, 100);
async function finalize() {
  clearInterval(samplingTimer);
  while (sampling) await new Promise(resolve => setTimeout(resolve, 10));
  await sampleArtifacts(); await queue;
  const canonical = await readFile('/data/canonical.json').catch(() => null);
  const filteredReplay = canonical ? filter(JSON.parse(canonical)) : null;
  if (canonical && !filteredReplay.changed) await writeFile('/results/canonical-replay.json', canonical, { mode: 0o600 });
  else if (filteredReplay) await writeFile('/results/credential-redacted-replay.json', JSON.stringify({ redacted: true, originalSha256: digest(canonical), recording: filteredReplay.value }), { mode: 0o600 });
  const result = summarize(config, records, artifacts);
  const intervention = JSON.parse(await readFile('/data/intervention.json', 'utf8').catch(() => 'null'));
  if (intervention) await writeFile('/results/intervention.json', JSON.stringify(intervention, null, 2), { mode: 0o600 });
  result.intervention = intervention;
  result.replay = { available: Boolean(canonical && !filteredReplay.changed), credentialRedacted: filteredReplay?.changed ?? false, sha256: canonical ? digest(canonical) : null };
  await writeFile('/results/report.json', JSON.stringify(redact(result), null, 2) + '\n', { mode: 0o600 });
  return result;
}
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${auditToken}`) { res.writeHead(403).end(); return; }
  try {
    if (req.method === 'POST' && req.url === '/events') {
      const event = JSON.parse(await body(req));
      // A single writer assigns sequence/hash only after the preceding durable write completes.
      const task = queue.then(() => append(event)); queue = task.catch(() => {}); await task;
      res.writeHead(201).end();
    } else if (req.method === 'POST' && req.url === '/finish') {
      await queue; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await finalize()));
    } else res.writeHead(404).end();
  } catch { res.writeHead(500).end('Audit failure'); }
});
server.listen(8800, '0.0.0.0');
