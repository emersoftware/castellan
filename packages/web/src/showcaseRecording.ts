import type { MatchStatus, ReplayFile, SpectatorView } from "@castellan/shared";
import type { CameraShot } from "./showcaseCamera";

/** Rendered board states, not executable orders. Watch and the full replay keep
 * using the real engine; the decorative hero only decodes these recordings. */
export interface ShowcaseManifest {
  format: 1;
  id: string;
  tickRate: number;
  ruleset: ReplayFile["ruleset"];
  players: ReplayFile["players"];
  startTick: number;
  finalTick: number;
  chunks: { url: string; firstTick: number; lastTick: number }[];
  /** The hero's planned shots, in tick order; absent in older recordings. */
  camera?: CameraShot[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectValue = { [key: string]: Json };
// Replacement, object property changes/deletions, or array index changes/length.
type Delta = [0, Json] | [1, Record<string, Delta>, string[]?] | [2, number, Record<string, Delta>];
export interface ShowcaseChunk { format: 1; first: ObjectValue; deltas: Delta[] }
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (): never => { throw new Error("Invalid showcase recording."); };
const STATUSES: readonly MatchStatus[] = ["waiting", "prep", "running", "finished"];

function difference(before: Json, after: Json): Delta | undefined {
  if (before === after) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: Record<string, Delta> = {};
    for (let i = 0; i < after.length; i++) {
      const delta = i < before.length ? difference(before[i], after[i]) : [0, after[i]] as Delta;
      if (delta) changes[i] = delta;
    }
    return before.length !== after.length || Object.keys(changes).length ? [2, after.length, changes] : undefined;
  }
  if (object(before) && object(after)) {
    const changes: Record<string, Delta> = {};
    for (const key of Object.keys(after)) {
      const delta = Object.hasOwn(before, key) ? difference(before[key], after[key]) : [0, after[key]] as Delta;
      if (delta) Object.defineProperty(changes, key, { value: delta, enumerable: true });
    }
    const removed = Object.keys(before).filter(key => !Object.hasOwn(after, key));
    if (!Object.keys(changes).length && !removed.length) return;
    return removed.length ? [1, changes, removed] : [1, changes];
  }
  return [0, after];
}

/** Copy only changed ancestors: already-decoded frames remain immutable. */
function apply(before: Json | undefined, delta: unknown): Json {
  if (!Array.isArray(delta)) return invalid();
  if (delta[0] === 0 && delta.length === 2) return delta[1] as Json;
  if (delta[0] === 1 && (delta.length === 2 || delta.length === 3) && object(before) && object(delta[1])) {
    const result = { ...before };
    if (delta.length === 3) {
      if (!Array.isArray(delta[2]) || !delta[2].every(key => typeof key === "string")) return invalid();
      for (const key of delta[2]) delete result[key];
    }
    for (const [key, change] of Object.entries(delta[1])) Object.defineProperty(result, key, {
      value: apply(Object.hasOwn(before, key) ? before[key] : undefined, change), enumerable: true, configurable: true, writable: true,
    });
    return result;
  }
  if (delta[0] === 2 && delta.length === 3 && Array.isArray(before) && Number.isSafeInteger(delta[1])
    && delta[1] >= 0 && delta[1] <= 1_000_000 && object(delta[2])) {
    const result = before.slice(0, delta[1]);
    for (const [key, change] of Object.entries(delta[2])) {
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= delta[1] || String(index) !== key) return invalid();
      result[index] = apply(before[index], change);
    }
    if (result.length !== delta[1] || Array.from({ length: result.length }, (_, i) => i).some(i => !Object.hasOwn(result, String(i)))) return invalid();
    return result;
  }
  return invalid();
}

function pack(frame: SpectatorView): ObjectValue {
  // Normalize optional undefined fields exactly as a JSON response does.
  const { entities, ...rest } = JSON.parse(JSON.stringify(frame)) as SpectatorView;
  if (rest.perspectives) throw new Error("Showcase recordings must contain board-only frames.");
  return { ...rest, entities: Object.fromEntries(entities.map(entity => [entity.id, entity])), entityOrder: entities.map(entity => entity.id) } as unknown as ObjectValue;
}

function unpack(value: unknown, expectedTick?: number): SpectatorView {
  if (!object(value)) return invalid();
  const { entityOrder, entities, ...frame } = value;
  if (!Array.isArray(entityOrder) || !entityOrder.every(id => typeof id === "string") || !object(entities)
    || new Set(entityOrder).size !== entityOrder.length || Object.keys(entities).length !== entityOrder.length
    || !Number.isSafeInteger(frame.tick) || (frame.tick as number) < 0 || (expectedTick !== undefined && frame.tick !== expectedTick)
    || typeof frame.timeMs !== "number" || !Number.isFinite(frame.timeMs)
    || typeof frame.matchMs !== "number" || !Number.isFinite(frame.matchMs)
    || !STATUSES.some(status => status === frame.status)
    || !["players", "projectiles", "deposits", "events"].every(key => Array.isArray(frame[key])) || frame.perspectives !== undefined) return invalid();
  return { ...frame, entities: entityOrder.map(id => {
    const entity = Object.hasOwn(entities, id as string) ? entities[id as string] : undefined;
    if (!object(entity) || entity.id !== id) return invalid();
    return entity;
  }) } as unknown as SpectatorView;
}

/** Each chunk starts with a full state, so it can be downloaded or retried alone. */
export function encodeShowcaseChunk(frames: readonly SpectatorView[]): ShowcaseChunk {
  if (!frames.length) throw new Error("Cannot encode an empty showcase chunk.");
  let previous = pack(frames[0]);
  const first = previous;
  const deltas: Delta[] = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].tick !== frames[i - 1].tick + 1) throw new Error("Showcase frames must have consecutive ticks.");
    const current = pack(frames[i]);
    deltas.push(difference(previous, current)!);
    previous = current;
  }
  return { format: 1, first, deltas };
}

export function decodeShowcaseChunk(value: unknown): SpectatorView[] {
  if (!object(value) || value.format !== 1 || !Array.isArray(value.deltas) || value.deltas.length > 10_000) return invalid();
  let state: Json = value.first;
  const frames = [unpack(state)];
  for (const delta of value.deltas) {
    state = apply(state, delta);
    frames.push(unpack(state, frames[frames.length - 1].tick + 1));
  }
  return frames;
}

/** Files are explicitly gzip encoded, including when served by the dev server. */
export async function readShowcaseChunk(response: Response): Promise<SpectatorView[]> {
  if (!response.ok) throw new Error(`Couldn’t load the showcase (${response.status}).`);
  if (!response.body) throw new Error("The showcase recording was empty.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A server may also set Content-Encoding: gzip, in which case fetch has
  // already decompressed the file. Inspect bytes instead of decompressing twice.
  const payload = new Response(bytes);
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? new Response(payload.body!.pipeThrough(new DecompressionStream("gzip"))) : payload;
  return decodeShowcaseChunk(await decoded.json());
}

export function parseShowcaseManifest(manifest: unknown): ShowcaseManifest {
  if (!object(manifest) || manifest.format !== 1 || typeof manifest.id !== "string"
    || typeof manifest.tickRate !== "number" || !Number.isFinite(manifest.tickRate) || manifest.tickRate <= 0
    || !Number.isSafeInteger(manifest.startTick) || (manifest.startTick as number) < 0
    || !Number.isSafeInteger(manifest.finalTick) || (manifest.finalTick as number) < (manifest.startTick as number)
    || !object(manifest.ruleset) || !object(manifest.ruleset.map) || !object(manifest.ruleset.kinds)
    || !Array.isArray(manifest.players) || !manifest.players.length
    || !manifest.players.every(player => object(player) && typeof player.id === "string" && typeof player.name === "string")
    || !Array.isArray(manifest.chunks) || !manifest.chunks.length) return invalid();
  let next = manifest.startTick as number;
  for (const chunk of manifest.chunks) {
    if (!object(chunk) || typeof chunk.url !== "string" || !/^[a-zA-Z0-9-]+\.json\.gz$/.test(chunk.url)
      || chunk.firstTick !== next || !Number.isSafeInteger(chunk.lastTick) || (chunk.lastTick as number) < next) return invalid();
    next = (chunk.lastTick as number) + 1;
  }
  if (next !== (manifest.finalTick as number) + 1) return invalid();
  if (manifest.camera !== undefined) {
    const coordinate = (n: unknown) => typeof n === "number" && Number.isFinite(n);
    let previous = -1;
    if (!Array.isArray(manifest.camera) || !manifest.camera.every(shot => {
      if (!object(shot) || !Number.isSafeInteger(shot.tick) || (shot.tick as number) <= previous) return false;
      previous = shot.tick as number;
      const box = shot.box;
      return box === null || (object(box) && coordinate(box.x0) && coordinate(box.y0) && coordinate(box.x1) && coordinate(box.y1)
        && (box.x1 as number) > (box.x0 as number) && (box.y1 as number) > (box.y0 as number));
    })) return invalid();
  }
  return manifest as unknown as ShowcaseManifest;
}
