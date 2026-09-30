// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SpectatorView } from "@aoa/shared";
import { SidePanel, PlayerList } from "../src/components/Hud";
import { playerPerspective } from "../src/perspective";
vi.mock("../src/audio/sfx", () => ({ sfx: { muted: true } }));
const frame: SpectatorView = { tick: 10, timeMs: 1000, matchMs: 60000, status: "running", events: [], deposits: [],
  players: [{ id: "p1", name: "Blue", capital: 100, pop: 4, popCap: 30, kills: 0, score: 1, team: 0, alive: true },
    { id: "p2", name: "Red", capital: 900, pop: 10, popCap: 30, kills: 0, score: 10, team: 1, alive: true }],
  entities: [{ id: "e1", kind: "agent", owner: "p1", x: 2, y: 2, hp: 400, maxHp: 400 },
    { id: "e2", kind: "agent", owner: "p2", x: 20, y: 20, hp: 400, maxHp: 400, order: "move 21,21" }],
};
it("uses engine perspective without hidden economy, events or entities and restores observer data", () => {
  const view = { ...frame, perspectives: { p1: { visibility: ["210"], entities: [frame.entities[0]], deposits: [], events: [],
    players: [frame.players[0], { id: "p2", name: "Red", team: 1, alive: true, popCap: 30 }] } } };
  const selected = playerPerspective(view, "p1")!;
  expect(selected.entities).toHaveLength(1); expect(selected.players[1].capital).toBeUndefined();
  expect(selected.visibility).toEqual(["210"]); expect(selected.perspectives).toBeUndefined();
  expect(playerPerspective(view, null)).toBe(view);
});
it("keeps legacy open-map visibility while removing opponents' private orders", () => {
  const selected = playerPerspective(frame, "p1")!;
  expect(selected.entities).toHaveLength(2); expect(selected.entities[1].order).toBeUndefined();
  expect(selected.visibility).toBeUndefined(); expect(frame.entities[1].order).toBeDefined();
});
it("selects a player's view with the eye column and returns to all", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), select = vi.fn();
  try {
    await act(async () => root.render(createElement(PlayerList, { view: frame, names: {}, colors: {}, selectedPlayer: "p1", onSelectPlayer: select })));
    const eyes = host.querySelectorAll<HTMLButtonElement>(".view-eye");
    expect(eyes).toHaveLength(3);
    expect(eyes[0].getAttribute("aria-pressed")).toBe("true");
    await act(async () => eyes[1].click()); expect(select).toHaveBeenLastCalledWith("p2");
    await act(async () => eyes[2].click()); expect(select).toHaveBeenLastCalledWith(null);
    expect(host.textContent).toContain("Age of Agents");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("switches conversation with the selected player and renders channel labels", async () => {
  const publicMessage = { tick: 1, from: "p1", name: "Blue", text: "hello" };
  const privateMessage = { tick: 2, from: "p2", name: "Red", text: "only blue and red, watch p1", channel: "private" as const, to: "p1" };
  const view = { ...frame, chat: [publicMessage], playerChats: { p1: [publicMessage, privateMessage], p3: [publicMessage] } };
  expect(playerPerspective(view, "p1")!.chat).toHaveLength(2);
  expect(playerPerspective(view, "p3")!.chat).toHaveLength(1);
  expect(playerPerspective(view, null)!.chat).toHaveLength(1);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    const seek = vi.fn();
    await act(async () => root.render(createElement(SidePanel, { players: null, events: [], chat: playerPerspective(view, "p1")!.chat!, names: { p1: "Blue", p2: "Red" }, colors: { p1: 0, p2: 1 }, tickMs: 100, player: "p1", onSeek: seek })));
    expect(host.querySelector(".mention.pc0")?.textContent).toBe("p1");
    expect(host.textContent).toContain("[private  Blue (p1)]"); expect(host.querySelector(".channel svg.arrow")).not.toBeNull();
    expect(host.textContent).toContain("only blue and red");
    expect(host.textContent).not.toContain("[all]");
    await act(async () => host.querySelectorAll<HTMLElement>(".log-body .line")[1].click());
    expect(seek).toHaveBeenLastCalledWith(2);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
