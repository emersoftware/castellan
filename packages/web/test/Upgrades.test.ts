// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EventFeed, PlayerList, Tooltip } from "../src/components/Hud";
import type { SpectatorView } from "@castellan/shared";
import { rules, type GameEvent } from "@castellan/shared";
import { fall, unitLook } from "../src/render/look";

vi.mock("../src/audio/sfx", () => ({ sfx: { muted: true } }));

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); vi.unstubAllGlobals(); });

it("shows completed upgrades but not work in progress, effective stats and replay events", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const view: SpectatorView = { tick: 50, timeMs: 5000, matchMs: 600000, status: "running", deposits: [], events: [],
    players: [{ id: "p1", name: "One", mineral: 50, pop: 4, popCap: 30, score: 90, kills: 0, team: 0, alive: true,
      upgrades: { worker_damage: 1 }, research: { upgrade: "knight_mobility", level: 1, completesAtMs: 15000 } }],
    entities: [{ id: "builder", kind: "worker", owner: "p1", x: 6, y: 5, hp: 40, maxHp: 40, construction: { kind: "nexus", x: 7, y: 5, completesAtMs: 35000 } },
      { id: "nexus", kind: "nexus", owner: "p1", x: 4, y: 4, hp: 600, maxHp: 600, training: [{ kind: "worker", completesAtMs: 10000 }, { kind: "archer" }] }],
  };
  await act(async () => root!.render(createElement(PlayerList, { view, names: {}, colors: {} })));
  expect(host.textContent).toContain("worker damage L1");
  expect(host.textContent).not.toMatch(/Researching|Building|Training|Queued/);
  await act(async () => root!.render(createElement(EventFeed, { names: {}, colors: {}, events: [
    { type: "upgrade_completed", tick: 150, owner: "p1", upgrade: "knight_mobility", level: 1 },
  ] })));
  expect(host.textContent).toContain("completed knight mobility L1");
  await act(async () => root!.render(createElement(Tooltip, { hover: { x: 1, y: 1, entity: {
    id: "e1", owner: "p1", kind: "knight", x: 1, y: 1, hp: 80, maxHp: 80,
    stats: { atk: 14, def: 4, range: 1, attackMs: 900, moveMs: 300 },
  } } })));
  expect(host.textContent).toContain("atk 14");
  expect(host.textContent).toContain("move 300ms");
});
