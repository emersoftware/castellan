// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NEUTRAL_OWNER, type EntityView, type SpectatorView } from "@castellan/shared";
import { Agent } from "../src/components/Agent";
import { UnitPanel } from "../src/components/Hud";
import { RAMPS, PLAYER_RAMPS } from "../src/render/palette";
import { createField, frameAt } from "./support/battlefield";

vi.mock("../src/audio/sfx", () => ({ sfx: {} }));
const wall: EntityView = { id: "neutral-wall", kind: "wall", owner: NEUTRAL_OWNER, x: 12, y: 0, hp: 300, maxHp: 300, ruin: true };

it("identifies a scenario wall without a player colour, agent, or running script", () => {
  const owner = renderToStaticMarkup(createElement(Agent, { id: NEUTRAL_OWNER }));
  expect(owner).toContain("scenario");
  expect(owner).not.toContain("pc0");
  const panel = renderToStaticMarkup(createElement(UnitPanel, { entity: wall, last: wall, script: undefined, tickMs: 100, onClose: () => {} }));
  expect(panel).toContain("Inert, destructible ruin");
  expect(panel).not.toContain("loading script");
  expect(panel).not.toContain("running its script");
  expect(panel).not.toContain("bg0");
});

it("keeps walls neutral through animation, fog, damage and replay seeks", () => {
  const h = createField({ colors: { p1: 0 } });
  const frame = (tick: number, rest: Partial<SpectatorView> = {}) => frameAt(tick, [wall, { ...wall, id: "owned", owner: "p1", x: 13, ruin: undefined }], rest);
  for (const tick of [0, 1, 0]) {
    h.field.seek(frame(tick), 100);
    h.animate();
    const sprite = h.sprite(wall.id);
    expect(sprite.tint).toBe(RAMPS.neutral.key);
    expect(h.occluderOf(sprite)!.tint & 255).toBe(0); // cannot masquerade as player 1 for x-ray
    expect(h.layers.xray.children).toHaveLength(0); // buildings never get x-ray bodies
    expect(h.sprite("owned").tint).toBe(PLAYER_RAMPS[0].key);
  }
  const visibility = Array.from({ length: 32 }, () => "1".repeat(32));
  h.field.seek(frame(2, { visibility, entities: [{ ...wall, hp: 200 }] }), 100);
  h.animate();
  const tint = h.sprite(wall.id).tint;
  expect((tint >> 16) & 255).toBe((tint >> 8) & 255);
  expect((tint >> 8) & 255).toBe(tint & 255);
  h.field.seek(frame(0), 100);
  h.animate();
  expect(h.sprite(wall.id).tint).toBe(RAMPS.neutral.key);
});
