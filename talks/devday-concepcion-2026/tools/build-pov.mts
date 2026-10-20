// One player's side of a clip: the board as that player sees it (fog and memory, the replay's own
// perspective) and the text state the engine hands that player, once per second.
// The match is re-simulated with the real QuickJS sandbox and every recorded hash is checked.
//
//   npx tsx talks/devday-concepcion-2026/tools/build-pov.mts
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createMatch } from '../../../packages/engine/src/index';
import { viewToText, type SpectatorView } from '../../../packages/shared/src/index';
import { playerPerspective } from '../../../packages/web/src/perspective';
import { encodeShowcaseChunk } from '../../../packages/web/src/showcaseRecording';

const ID = 'a21dc6cf', PLAYER = 'p1', START = 2024, END = 2223, EVERY = 10;
const talk = new URL('../', import.meta.url);
const replay = JSON.parse(gunzipSync(readFileSync(new URL(`research/replays/${ID}.json.gz`, talk))).toString('utf8'));

/** Board-only frame, as in build-clips. */
function board(v: SpectatorView): SpectatorView {
  const { perspectives: _p, playerChats: _c, ...rest } = v as SpectatorView & { playerChats?: unknown };
  return JSON.parse(JSON.stringify({ ...rest, chat: [], projectiles: rest.projectiles ?? [], deposits: rest.deposits ?? [], events: rest.events ?? [] }));
}

const m = await createMatch({ ruleset: replay.ruleset, seed: replay.seed, tickRate: replay.tickRate, players: replay.players });
const byTick = new Map<number, unknown[]>();
for (const o of replay.orders) byTick.set(o.tick, [...(byTick.get(o.tick) ?? []), { player: o.player, order: o.order }]);
const frames: SpectatorView[] = [], states: { tick: number; text: string }[] = [];
let desyncAt: number | undefined, asked = START - EVERY;
try {
  while (m.tick < replay.finalTick && !m.outcome) {
    const t = m.tick;
    m.step((byTick.get(t) ?? []) as never);
    if (replay.hashes[t] !== undefined && desyncAt === undefined && replay.hashes[t] !== m.hash()) desyncAt = t;
    if (m.tick < START || m.tick > END) continue;
    frames.push(board(playerPerspective(m.spectate(undefined, { includePrivateChat: true }), PLAYER)!));
    // Events since the previous ask, the way an agent polling every second receives them.
    if ((m.tick - START) % EVERY === 0) { states.push({ tick: m.tick, text: viewToText(m.view(PLAYER, asked)) }); asked = m.tick; }
  }
  if (replay.hashes[m.tick] !== undefined && replay.hashes[m.tick] !== m.hash()) desyncAt ??= m.tick;
} finally { m.dispose(); }
if (desyncAt !== undefined) throw new Error(`${ID} desync at ${desyncAt}`);

const meta = { format: 1, id: ID, tickRate: replay.tickRate, ruleset: replay.ruleset, players: replay.players, outcome: replay.outcome, pov: PLAYER,
  verification: { method: 'Full re-simulation with the real QuickJS sandbox; every recorded hash compared.', verified: true } };
const clip = new URL(`assets/clips/${ID}-${START}-${PLAYER}.json`, talk);
writeFileSync(clip, JSON.stringify({ ...meta, startTick: frames[0].tick, finalTick: frames.at(-1)!.tick, chunk: encodeShowcaseChunk(frames) }));
const text = new URL(`assets/clips/${ID}-${START}-${PLAYER}-state.json`, talk);
writeFileSync(text, JSON.stringify({ id: ID, player: PLAYER, every: EVERY, states }));
console.log(`${frames.length} frames (${(statSync(clip).size / 1024).toFixed(0)} KB), ${states.length} states, ~${Math.round(states.reduce((n, s) => n + s.text.length, 0) / states.length)} chars each`);
