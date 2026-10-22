import { createServer } from 'node:http';
import { connect, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { report } from './audit.mjs';

// Exact destinations, per source IP. No wildcard, arbitrary ports, HTTP forwarding or upstream proxies.
const HOSTS = { claude: ['api.anthropic.com', 'platform.claude.com', 'console.anthropic.com'],
  codex: ['api.openai.com', 'chatgpt.com', 'auth.openai.com'], fixture: [] };
export function destination(authority, harness) {
  const match = /^([a-z0-9.-]+):443$/.exec(authority ?? '');
  return match && !isIP(match[1]) && HOSTS[harness]?.includes(match[1]) ? match[1] : null;
}
export function publicIPv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && [168, 0, 2].includes(b)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19, 51].includes(b)) && !(a === 203 && b === 0);
}
async function main() {
  const config = JSON.parse(await readFile('/config/experiment.json', 'utf8'));
  const { auditToken } = JSON.parse(await readFile('/config/private/control.json', 'utf8'));
  const proxy = createServer((_req, res) => res.writeHead(403).end('CONNECT only'));
  proxy.on('connect', async (req, socket, head) => {
    let upstream;
    try {
      const p = config.players.find(p => p.ip === socket.remoteAddress?.replace(/^::ffff:/, ''));
      const host = destination(req.url, p?.harness);
      await report(auditToken, { kind: 'egress', actor: p?.seat ?? 'unknown', destination: String(req.url).slice(0, 256), allowed: Boolean(host) });
      if (!host) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const resolved = await lookup(host, { family: 4, all: true });
      if (!resolved.length || resolved.some(r => !publicIPv4(r.address))) throw new Error('Non-public destination');
      // Connect to the checked address directly; a second DNS lookup cannot rebind it.
      upstream = connect({ host: resolved[0].address, port: 443 });
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
      upstream.setTimeout(180_000, () => upstream.destroy()); socket.setTimeout(180_000, () => socket.destroy());
      upstream.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); upstream.pipe(socket); socket.pipe(upstream); });
      socket.on('close', () => upstream.destroy());
    } catch { upstream?.destroy(); socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); }
  });
  proxy.listen(3128, '0.0.0.0');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
