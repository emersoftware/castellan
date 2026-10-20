// Packs the board clips the talk plays into assets/clips/<id>-<start>.json.
//
// Two sources:
//  - "engine": replays the current engine reproduces. The whole match is re-simulated with the
//    real QuickJS sandbox (playRecordedReplay) and every recorded hash is checked; a clip is only
//    written if the replay verifies end to end.
//  - "extracted": research/clips/<id>.json, frames already produced with a historical engine by
//    the evidence work; their own verification block is copied unchanged.
// Each window is stored as one delta chunk (showcase format, decodeShowcaseChunk). Board only:
// chat and perspectives are dropped; the slides show the literal messages from citas-escenario.json.
//
//   npx tsx talks/devday-concepcion-2026/tools/build-clips.mts [clipKey...]
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { playRecordedReplay } from '../../../packages/web/src/replayPlayback';
import { encodeShowcaseChunk } from '../../../packages/web/src/showcaseRecording';
import type { SpectatorView } from '../../../packages/shared/src/index';

const talk = new URL('../', import.meta.url);
const out = new URL('assets/clips/', talk);
mkdirSync(out, { recursive: true });

type Window = { start: number; end: number };
/** file: extracted source under research/clips/ (default <id>-observer.json). */
type Spec = { key: string; id: string; source: 'engine' | 'extracted'; windows: Window[]; file?: string };
const SPECS: Spec[] = [
  { key: 'deception', id: '796f00b9', source: 'engine', windows: [{ start: 4130, end: 4420 }, { start: 4680, end: 4822 }] },
  { key: 'timeout', id: 'fbc091c3', source: 'engine', windows: [{ start: 5800, end: 6000 }] },
  { key: 'showcase', id: '02eb6795', source: 'engine', windows: [{ start: 1743, end: 1942 }, { start: 4774, end: 4974 }] },
  // Grok B's archer script (uploaded t3172): two archers step back from p1's knights and shoot when ready. Focus 12,5,24,16.
  { key: 'archer-script', id: 'fbc091c3', source: 'engine', windows: [{ start: 4040, end: 4240 }] },
  // Opus 5.5 Low A turtles in the NW corner (8 turrets); p4's knights break on it from t7030. Focus 0,0,16,18.
  { key: 'turtle', id: 'bd6acba5', source: 'engine', windows: [{ start: 7020, end: 7220 }] },
  { key: 'towers', id: '25fe89ae', source: 'extracted', windows: [{ start: 640, end: 839 }] },
  { key: 'draw', id: '77e80cf4', source: 'extracted', windows: [{ start: 4250, end: 4470 }, { start: 5800, end: 6000 }] },
  // Claude Code (Opus 5.5 low, p1 blue) vs Codex (GPT-6.1 Sol low, p2 red), 1v1 fortress 32x32: knights and archers trade mid-map. Focus 14,4,26,16.
  { key: 'claude-codex', id: '1b4b65c9', source: 'engine', windows: [{ start: 1490, end: 1690 }] },
  // «Pure turtle» p3: its 9 rangers reach p4's NE base and p4's knights wipe them out (p4 calls it out at t2369). Focus 54,0,64,14.
  { key: 'lie', id: '77e80cf4', source: 'extracted', file: '77e80cf4-lie-observer.json', windows: [{ start: 2290, end: 2490 }] },
  // After the truce (t4337) and the king-hunt script (t4365): p3's knights hit p4's knights mid-map, then p4's outer base. Focus 8,22,22,36.
  // Landing hero (0.29.2): fortress free-for-all, Opus 5.5 (p1) · Sol 6.1 (p2) · Fable 5.1 (p3) · Astra 6 (p4); centre fight. Focus map.
  { key: 'ffa', id: 'a21dc6cf', source: 'engine', windows: [{ start: 2024, end: 2223 }] },
  // Same match, Opus's base (p1, SW): workers and archers come out of the castle (t393-538); a worker raises a second castle at 17,39 (t968-1168; sites are not drawn until finished);
  // Opus's archers at Fable's south wall while Fable (p3) offers Opus a truce (t2872).
  // Upgrades gap: Sol 6.1 (p3, 9 upgrades by then) vs Opus 5.5 (p1, none); Sol's archers kill 6 of Opus's archers and a knight for one loss. Focus 2,26,14,40.
  { key: 'upgrades', id: '2346f20b', source: 'engine', windows: [{ start: 4240, end: 4439 }] },
  { key: 'basics', id: 'a21dc6cf', source: 'engine', windows: [{ start: 380, end: 579 }, { start: 1130, end: 1329 }, { start: 2860, end: 3059 }] },
  { key: 'betrayal', id: '796f00b9', source: 'engine', windows: [{ start: 4440, end: 4600 }] },
  // King down: Opus 5.5 (p1) kills Sol 6.1's king (p2) at 22,8, t3342; p2 is eliminated. Focus 16,2,28,14.
  { key: 'king-death', id: 'a21dc6cf', source: 'engine', windows: [{ start: 3250, end: 3449 }] },
  // Gameplay sheet: the 18x18 area with the most kinds, actions and events at once (score-moments.mts): castle, king, workers, wall, door, knights, archers, tower. Focus 18,18,40,40 (a wider frame around it).
  { key: 'gameplay', id: '02eb6795', source: 'engine', windows: [{ start: 4700, end: 4899 }] },
  // Experiments slide: Fable 5.1 (Claude Code) vs Astra 6 (Codex), open map, 0.29.3, low; the fight with the most deaths and arrows (score-moments.mts). Focus 8,8,26,26.
  { key: 'experiments-fight', id: '9463fc7e', source: 'engine', windows: [{ start: 1700, end: 1899 }] },
  // Scripts scene. Sol 6.1 (p2) king flees with its one-line script (t2758). Focus 30,30,44,44.
  { key: 'script-sol', id: 'a21dc6cf', source: 'engine', windows: [{ start: 2800, end: 2999 }] },
  // Sol 6.1 Low 3's king dodges projectiles (script t3424) until it falls at t4074. Focus 26,14,44,40.
  { key: 'script-dodge', id: '346f9d24', source: 'engine', windows: [{ start: 3875, end: 4074 }] },
  // Gemini 4 Argon (p2): its knight script writes to «me» and throws; the knight stands. Focus 28,28,44,44.
  { key: 'script-gemini', id: '242b57f9', source: 'engine', windows: [{ start: 4881, end: 5080 }] },
  // Mistral Large 4 (p4): workers mining in the SW corner under its worker script (t83). Focus 0,28,14,42.
  { key: 'script-mistral', id: '9cf148fb', source: 'engine', windows: [{ start: 300, end: 499 }] },
];
const wanted = process.argv.slice(2);

/** Board-only frame: the renderer needs entities, deposits, events and projectiles. */
function board(v: SpectatorView): SpectatorView {
  const { perspectives: _p, playerChats: _c, ...rest } = v as SpectatorView & { playerChats?: unknown };
  return JSON.parse(JSON.stringify({ ...rest, chat: [], projectiles: rest.projectiles ?? [], deposits: rest.deposits ?? [], events: rest.events ?? [] }));
}

const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: new URL('../../', talk) }).toString().trim(); } catch { return 'unknown'; } })();

function write(spec: Spec, meta: Record<string, unknown>, frames: Map<number, SpectatorView>) {
  for (const w of spec.windows) {
    const slice: SpectatorView[] = [];
    for (let t = w.start; t <= w.end; t++) {
      const f = frames.get(t);
      if (!f) { if (slice.length) break; continue; }
      slice.push(f);
    }
    const last = slice[slice.length - 1]?.tick;
    if (!slice.length || slice[0].tick !== w.start || last !== w.end) throw new Error(`${spec.id} window ${w.start}-${w.end} incomplete: ${slice[0]?.tick}-${last}`);
    const file = new URL(`${spec.id}-${w.start}.json`, out);
    writeFileSync(file, JSON.stringify({ ...meta, startTick: slice[0].tick, finalTick: last, chunk: encodeShowcaseChunk(slice) }));
    console.log(`  wrote ${file.pathname.split('/talks/')[1]} ticks ${slice[0].tick}-${last} (${slice.length} frames, ${(statSync(file).size / 1024).toFixed(0)} KB)`);
  }
}

for (const spec of SPECS) {
  if (wanted.length && !wanted.includes(spec.key) && !wanted.includes(spec.id)) continue;
  console.log(`${spec.key} · ${spec.id} (${spec.source})`);
  if (spec.source === 'engine') {
    const replay = JSON.parse(gunzipSync(readFileSync(new URL(`research/replays/${spec.id}.json.gz`, talk))).toString('utf8'));
    const keep = new Map<number, SpectatorView>();
    const inWindow = (t: number) => spec.windows.some(w => t >= w.start && t <= w.end);
    let outcome: unknown;
    const check = await playRecordedReplay(replay, v => {
      if (v.outcome) outcome = v.outcome;
      if (inWindow(v.tick)) keep.set(v.tick, board(v));
    });
    const hashes = Object.keys(replay.hashes).length;
    const outcomeOk = (outcome as { reason?: string; winner?: string | null } | undefined)?.reason === replay.outcome.reason
      && ((outcome as { winner?: string | null }).winner ?? null) === (replay.outcome.winner ?? null);
    if (!check.verified || !outcomeOk) throw new Error(`${spec.id} did not verify: ${JSON.stringify(check)} outcome ${JSON.stringify(outcome)}`);
    write(spec, {
      format: 1, id: spec.id, tickRate: replay.tickRate, ruleset: replay.ruleset, players: replay.players, outcome: replay.outcome,
      verification: { engine: `aoa ${commit} (working tree)`, method: 'Full re-simulation with the real QuickJS sandbox; every recorded hash compared.', hashesChecked: hashes, verified: true, outcomeMatches: true },
    }, keep);
  } else {
    // The observer variant drops only perspectives and per-player chat (research/clips/README.md).
    const name = spec.file ?? `${spec.id}-observer.json`;
    const path = new URL(`research/clips/${name}`, talk);
    if (!existsSync(path)) throw new Error(`${spec.id}: research/clips/${name} missing`);
    const clip = JSON.parse(readFileSync(path, 'utf8'));
    const keep = new Map<number, SpectatorView>(clip.frames.map((f: SpectatorView) => [f.tick, board(f)]));
    write(spec, { format: 1, id: spec.id, tickRate: clip.tickRate, ruleset: clip.ruleset, players: clip.players, verification: clip.verification }, keep);
  }
}
