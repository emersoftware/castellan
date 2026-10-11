// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Outcome, SpectatorView } from "@aoa/shared";
import { OutcomeBanner } from "../src/components/Hud";
import { wonText } from "../src/components/Versus";

vi.mock("../src/audio/sfx", () => ({ sfx: {} }));

const players = [{ id: "p1", name: "one" }, { id: "p2", name: "two" }];
const draw: Outcome = { winner: null, winners: [], reason: "timeout", scores: {} };
function banner(outcome: Outcome): string {
  const view: SpectatorView = { tick: 1, timeMs: 100, matchMs: 100, status: "finished",
    players: [], entities: [], projectiles: [], deposits: [], events: [], outcome };
  return renderToStaticMarkup(createElement(OutcomeBanner, { view, names: { p1: "one", p2: "two" } }));
}

it("shows a defeat for everyone in the replay banner and battle result", () => {
  const outcome = { ...draw, allDefeated: true as const };
  expect(banner(outcome)).toContain("All players defeated");
  expect(banner(outcome)).toContain("time limit reached: everyone loses");
  expect(banner(outcome)).not.toContain("Stalemate");
  expect(wonText(players, outcome)).toBe("all players defeated");
});

it("keeps historical draws and victories on score visible as recorded", () => {
  expect(banner(draw)).toContain("Stalemate");
  expect(banner(draw)).toContain("time limit reached: draw");
  expect(wonText(players, draw)).toBe("draw");
  const old: Outcome = { winner: "p1", reason: "timeout", scores: { p1: 200, p2: 100 } };
  expect(banner(old)).toContain("victorious");
  expect(banner(old)).toContain("victory on score under this replay&#x27;s rules");
  expect(banner(old)).not.toContain("All players defeated");
});

it("reports mutual elimination as a defeat without blaming the time limit", () => {
  const outcome = { ...draw, reason: "vital_lost" as const, allDefeated: true as const };
  expect(banner(outcome)).toContain("no surviving side: everyone loses");
  expect(banner(outcome)).not.toContain("time limit");
});
