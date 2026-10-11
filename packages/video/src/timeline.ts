import type { GameEvent, Outcome, PlayerStats } from "@aoa/shared";

/** What packages/sim/src/video-timeline.mts writes for a replay (game milliseconds). */
export interface Timeline {
  id: string; version: string; map: string; endMs: number; matchMs: number; tickMs: number;
  players: { id: string; name: string; side: number; built: Record<string, number>; lost: number; orders: number }[];
  winners: string[]; reason: string; kingDeathMs: number | null; outcome: Outcome;
  highlights: { fromMs: number; toMs: number; lost: Record<string, number>; final: boolean }[];
  scripts: { ms: number; player: string; kind: string; code: string }[];
  chat: { ms: number; from: string; text: string }[];
  deaths: { ms: number; owner: string; kind: string }[];
  /** Spectator player stats once a second, and the events the feed shows. */
  stats: { timeMs: number; players: PlayerStats[] }[];
  feed: GameEvent[];
}

/** The footage was recorded at this game speed, at 720×540 game pixels scaled 2×. */
export const SPEED = 2;
export const GAME_W = 720, GAME_H = 540, PIXEL = 2;
export const INTRO_S = 3.5;
export const OUTRO_HOLD_S = 3;

export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
/** Seconds of footage a highlight lasts (the final one holds the end screen). */
export const highlightSeconds = (h: Timeline["highlights"][number]) => (h.toMs - h.fromMs) / 1000 / SPEED + (h.final ? OUTRO_HOLD_S : 0);
