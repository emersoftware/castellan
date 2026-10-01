// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";

const contexts: any[] = [];
function param(value = 1) {
  return { value, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
}
class Context {
  state = "running"; currentTime = 0; destination = {}; gains: any[] = []; sources: any[] = [];
  constructor() { contexts.push(this); }
  resume = vi.fn().mockResolvedValue(undefined);
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 2 });
  createGain() { const gain = { gain: param(), connect: vi.fn().mockReturnThis() }; this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return { connect: vi.fn().mockReturnThis() }; }
  createStereoPanner() { return { pan: param(), connect: vi.fn().mockReturnThis() }; }
  createBufferSource() { const source = { connect: vi.fn().mockReturnThis(), start: vi.fn(), stop: vi.fn(), playbackRate: param() }; this.sources.push(source); return source; }
}
beforeEach(() => {
  vi.resetModules();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  contexts.length = 0;
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    json: async () => url.includes("sounds") ? { pad: 0, loop: 2, files: { sword: ["sword.mp3"], ambient: ["wind.mp3"] } } : { pad: 0, loop: 2 },
    arrayBuffer: async () => new ArrayBuffer(0),
  })));
});
async function settled() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
it("migrates the old preference, then persists music and effects independently", async () => {
  localStorage.setItem("aoa:muted", "1");
  const { sfx } = await import("../src/audio/sfx");
  expect(sfx.muted).toBe(true);
  sfx.setEffectsMuted(false);
  expect(sfx.musicMuted).toBe(true);
  sfx.setMusicMuted(false);
  sfx.setEffectsMuted(true);
  expect(sfx.musicMuted).toBe(false);
  expect(localStorage.getItem("aoa:effects-muted")).toBe("1");
  expect(localStorage.getItem("aoa:music-muted")).toBe("0");
});
it("keeps battle music behind effects and muting sounds leaves its source playing", async () => {
  const { sfx } = await import("../src/audio/sfx");
  const release = sfx.holdMusic("battle");
  sfx.unlock(); await settled();
  const ctx = contexts[0];
  const music = ctx.sources.at(-1);
  expect(ctx.gains.some((g: any) => g.gain.exponentialRampToValueAtTime.mock.calls.some(([gain]: number[]) => gain === 0.09))).toBe(true);
  sfx.setEffectsMuted(true);
  expect(music.stop).not.toHaveBeenCalled();
  const count = ctx.sources.length;
  sfx.play("sword");
  expect(ctx.sources).toHaveLength(count);
  sfx.setMusicMuted(true);
  expect(music.stop).toHaveBeenCalled();
  sfx.setEffectsMuted(false); await settled();
  sfx.play("sword");
  expect(ctx.sources).toHaveLength(count + 1);
  expect(sfx.musicMuted).toBe(true);
  release();
});
it("does not start a pending track after music is disabled", async () => {
  const { sfx } = await import("../src/audio/sfx");
  sfx.holdMusic("battle"); sfx.unlock(); sfx.setMusicMuted(true);
  await settled();
  expect(contexts[0].sources).toHaveLength(0);
});
