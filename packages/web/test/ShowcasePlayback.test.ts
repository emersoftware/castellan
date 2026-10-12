// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { rules, type SpectatorView } from "@aoa/shared";
import { encodeShowcaseChunk, type ShowcaseManifest } from "../src/showcaseRecording";
import { useShowcase } from "../src/useShowcase";

let root: Root, host: HTMLDivElement, client: QueryClient;
let player: ReturnType<typeof useShowcase>;
const makeFrame = (tick: number): SpectatorView => ({ tick, timeMs: tick * 100, matchMs: 5000, status: "running", players: [], entities: [], deposits: [], events: [], projectiles: [] });
const manifest: ShowcaseManifest = {
  format: 1, id: "test", tickRate: 10, ruleset: rules, players: [{ id: "p1", name: "Player" }], startTick: 10, finalTick: 13,
  chunks: [{ url: "10-first.json.gz", firstTick: 10, lastTick: 11 }, { url: "12-next.json.gz", firstTick: 12, lastTick: 13 }],
};
const chunk = (...ticks: number[]) => new Response(JSON.stringify(encodeShowcaseChunk(ticks.map(makeFrame))), { headers: { "content-type": "application/json" } });
function Harness() { player = useShowcase("test"); return createElement("span", null, player.frame?.tick); }
const mount = async () => {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  await vi.waitFor(() => expect(player.frame?.tick).toBe(10));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("Worker", vi.fn(() => { throw new Error("The hero must never create an engine worker"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it("holds its opening for the renderer, buffers without skipping ticks, then loops only after the final frame", async () => {
  vi.useFakeTimers();
  let finishNext!: (value: Response) => void;
  const next = new Promise<Response>(resolve => { finishNext = resolve; });
  const request = vi.fn((url: string) => url.endsWith("manifest.json") ? Promise.resolve(Response.json(manifest))
    : url.endsWith("10-first.json.gz") ? Promise.resolve(chunk(10, 11)) : next);
  vi.stubGlobal("fetch", request);
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(player.frame?.tick).toBe(10);
  expect(request.mock.calls.map(([url]) => url)).toHaveLength(2);
  await act(async () => { player.onReady(); await vi.advanceTimersByTimeAsync(100); });
  expect(player.frame?.tick).toBe(11);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(player.frame?.tick).toBe(11);
  await act(async () => { finishNext(chunk(12, 13)); await next; });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(player.frame?.tick).toBe(12);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(player.frame?.tick).toBe(13);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(player.frame?.tick).toBe(10);
  expect(player.jumpKey).toBe(1);
  expect(Worker).not.toHaveBeenCalled();
});

it("reports a failed chunk and retries playback from its opening", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.endsWith("manifest.json") ? Response.json(manifest)
    : ++attempts === 1 ? new Response("unavailable", { status: 503 }) : chunk(10, 11))));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  await vi.waitFor(() => expect(player.error).toBe(true));
  expect(player.frame).toBeNull();
  await act(async () => player.retry());
  await vi.waitFor(() => expect(player.frame?.tick).toBe(10));
  expect(player.error).toBe(false);
  expect(attempts).toBe(2);
});

it("aborts an unfinished chunk download when the page unmounts", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
    if (url.endsWith("manifest.json")) return Promise.resolve(Response.json(manifest));
    signal = options?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  }));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  await vi.waitFor(() => expect(signal).toBeDefined());
  await act(async () => root.unmount());
  expect(signal!.aborted).toBe(true);
  root = createRoot(host);
});

it("refreshes changed chunk URLs when retrying after a deployment", async () => {
  let published = manifest;
  const request = vi.fn((url: string) => Promise.resolve(url.endsWith("manifest.json") ? Response.json(published)
    : url.endsWith("10-replaced.json.gz") ? chunk(10, 11) : new Response("gone", { status: 404 })));
  vi.stubGlobal("fetch", request);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  await vi.waitFor(() => expect(player.error).toBe(true));
  published = { ...manifest, chunks: [{ ...manifest.chunks[0], url: "10-replaced.json.gz" }, manifest.chunks[1]] };
  await act(async () => player.retry());
  await vi.waitFor(() => expect(player.frame?.tick).toBe(10));
  expect(player.error).toBe(false);
  expect(request.mock.calls.map(([url]) => url)).toContain("/showcase/test/10-replaced.json.gz");
});
