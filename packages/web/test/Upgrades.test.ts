// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EventFeed, PlayerList, Tooltip } from "../src/components/Hud";
import type { SpectatorView } from "@castellan/shared";
import { currentFrame, rules, type GameEvent, type RecordedKind } from "@castellan/shared";
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

it("shows current labels and animations for legacy replay data read through the viewer boundary", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const view = currentFrame({ tick: 10, timeMs: 1000, matchMs: 15000, status: "running", deposits: [], events: [], entities: [],
    players: [{ id: "p1", name: "One", capital: 1700, pop: 5, popCap: 30, team: 0, alive: true,
      upgrades: { ranger_damage: 1, turret_range: 1 } }],
  } as unknown as SpectatorView);
  await act(async () => root!.render(createElement(PlayerList, { view, names: {}, colors: {} })));
  expect(host.textContent).toContain("1700");
  expect(host.textContent).toContain("archer damage L1");
  expect(host.textContent).toContain("tower range L1");
  expect(host.textContent).not.toMatch(/capital|ranger|turret/);
  const { events } = currentFrame({ players: [], entities: [], events: [
    { type: "spawn", tick: 10, id: "e1", owner: "p1", kind: "ranger", x: 3, y: 3 },
    { type: "spawn", tick: 10, id: "e2", owner: "p1", kind: "turret", x: 4, y: 3 },
  ] as GameEvent[] });
  await act(async () => root!.render(createElement(EventFeed, { names: {}, colors: {}, events })));
  expect(host.textContent).toContain("trained an archer");
  expect(host.textContent).toContain("built a tower");
  expect(host.textContent).not.toMatch(/ranger|turret/);
  const pose = (kind: RecordedKind) => unitLook({ kind, x: 0, y: 0 }, 2, 700, { strike: { at: 100, dir: 2 } });
  expect(pose("ranger")).toEqual(pose("archer"));
  const collapse = (kind: RecordedKind) => fall({ kind, hp: 0, maxHp: 1 }, rules.kinds.tower).at(800);
  expect(collapse("turret")).toEqual(collapse("tower"));
});
