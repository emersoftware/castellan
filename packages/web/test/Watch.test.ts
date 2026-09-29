// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Watch } from "../src/routes/Watch";

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ id: "test" }), Link: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: {
    status: "prep", prepEndsAt: "2000-01-01T00:00:00Z", players: [],
  } }),
}));
vi.mock("../src/components/GameCanvas", () => ({ GameCanvas: () => null }));
vi.mock("../src/components/Hud", () => ({
  ChatPanel: () => null, EventFeed: () => null, OutcomeBanner: () => null, SoundToggle: () => null,
  Tooltip: () => null, PlayerList: () => null,
}));
vi.mock("../src/routes/Replay", () => ({ ReplayPlayer: ({ id }: { id: string }) => createElement("div", null, `Saved replay ${id}`) }));
vi.mock("../src/audio/sfx", () => ({ sfx: { muted: true } }));

let root: Root;
let host: HTMLDivElement;
let socket: { onmessage?: (m: { data: string }) => void; onclose?: (e: { code: number }) => void };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("WebSocket", class {
    constructor() { socket = this; }
    onmessage?: (m: { data: string }) => void;
    close() {}
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Watch)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each(["running", "finished"])("uses websocket %s over stale lobby prep status", async (status) => {
  expect(host.textContent).toContain("The battle begins in");
  await act(async () => socket.onmessage!({ data: JSON.stringify({
    type: "frame", view: { status, events: [] },
  }) }));
  expect(host.textContent).not.toContain("The battle begins in");
  expect(host.querySelector(".live")?.textContent).toBe(status === "running" ? "● live" : "finished");
});

it("opens the saved replay when a finished room is no longer in server memory", async () => {
  await act(async () => socket.onclose!({ code: 4404 }));
  expect(host.textContent).toContain("Saved replay test");
  expect(host.textContent).not.toContain("reconnecting");
});
