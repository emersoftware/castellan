// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";
import { SeriesViewer } from "../src/routes/Series";
import type { SeriesSummary } from "@aoa/shared";

const mock = vi.hoisted(() => ({ series: {} as SeriesSummary, replay: {} as { id: string; onEnded?: () => void; series?: ReactNode }, watch: "" }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mock.series }) }));
// The players render the series line under their title.
vi.mock("../src/routes/Replay", () => ({ ReplayPlayer: (props: typeof mock.replay) => { mock.replay = props; return props.series ?? null; } }));
vi.mock("../src/routes/Watch", () => ({ WatchPlayer: ({ id, series }: { id: string; series?: ReactNode }) => { mock.watch = id; return series ?? null; } }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.series = { id: "test", createdAt: "", totalGames: 3, status: "finished", currentGame: 3, players: [{ id: "p1", name: "One", team: 0 }, { id: "p2", name: "Two", team: 1 }], score: { p1: 2, p2: 1 }, winners: ["p1"], games: [1, 2, 3].map((number) => ({ number, roomId: `g${number}`, status: "finished" })) };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (live = false) => act(async () => root.render(createElement(SeriesViewer, { id: "test", live })));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it("plays all three games consecutively and supports selection", async () => {
  await render();
  expect(mock.replay.id).toBe("g1");
  await act(async () => mock.replay.onEnded!());
  expect(mock.replay.id).toBe("g2");
  await act(async () => mock.replay.onEnded!());
  expect(mock.replay.id).toBe("g3");
  expect(mock.replay.onEnded).toBeUndefined();
  expect(host.querySelector(".series-badge")?.getAttribute("title")).toBe("One (p1) wins the series");
  expect(host.querySelector(".series-score")?.textContent).toBe("2–1");
  await act(async () => button("Game 1").click());
  expect(mock.replay.id).toBe("g1");
});

it("follows the live game, disables future games, and does not reset auto-advance on polling", async () => {
  mock.series.status = "running"; mock.series.currentGame = 2;
  mock.series.games = mock.series.games.slice(0, 2); mock.series.games[1].status = "running";
  await render(true);
  expect(mock.watch).toBe("g2");
  expect(button("Game 3").disabled).toBe(true);
  await act(async () => button("Game 1").click());
  const ended = mock.replay.onEnded;
  mock.series = structuredClone(mock.series);
  await render(true);
  expect(mock.replay.onEnded).toBe(ended);
  await act(async () => mock.replay.onEnded!());
  expect(button("Follow live").getAttribute("aria-pressed")).toBe("true");
});
