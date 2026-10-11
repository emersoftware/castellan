// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Watch } from "../src/routes/Watch";
import { api, spectateUrl } from "../src/api";

vi.mock("@tanstack/react-router", () => ({ useParams: () => ({ id: "test" }), Link: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: {
    status: "prep", prepEndsAt: "2000-01-01T00:00:00Z", players: [],
  } }),
}));
vi.mock("../src/components/GameCanvas", () => ({ GameCanvas: () => null }));
vi.mock("../src/components/Hud", () => ({
  SidePanel: () => null, OutcomeBanner: () => null, SoundToggle: () => null,
  Tooltip: () => null, PlayerList: () => null, notableEvents: (events: unknown[]) => events,
}));
vi.mock("../src/routes/Replay", () => ({ ReplayPlayer: ({ id }: { id: string }) => createElement("div", null, `Saved replay ${id}`), writeUrl: () => {} }));
vi.mock("../src/audio/sfx", () => ({ sfx: { muted: true, holdAmbient: () => () => {}, holdMusic: () => () => {} } }));

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
  history.replaceState(null, "", "/");
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

it("explains denied live access without retrying or showing the prep countdown", async () => {
  await act(async () => socket.onclose!({ code: 4403 }));
  expect(host.textContent).toContain("Private live match");
  expect(host.textContent).not.toContain("The battle begins in");
  expect(host.textContent).not.toContain("reconnecting");
});

it("uses the host capability for both spectator endpoints", async () => {
  history.replaceState(null, "", "/watch/test#spectator=host-capability");
  expect(new URL(spectateUrl("test")).searchParams.get("spectator")).toBe("host-capability");
  const request = vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "application/json" }), json: async () => ({}) }));
  vi.stubGlobal("fetch", request);
  await api.roomScripts("test");
  expect(request).toHaveBeenCalledWith("/rooms/test/scripts", { headers: { authorization: "Bearer host-capability" } });
});
