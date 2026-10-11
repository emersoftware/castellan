// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Texture, type Sprite } from "pixi.js";
import { NEUTRAL_OWNER, rules, type EntityView, type SpectatorView } from "@aoa/shared";
import { Agent } from "../src/components/Agent";
import { UnitPanel } from "../src/components/Hud";
import { GameRenderer } from "../src/render/renderer";
import { RAMPS, PLAYER_RAMPS } from "../src/render/palette";
import type { SpriteSet } from "../src/render/sprites";

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
  const renderer = Reflect.construct(GameRenderer, [document.createElement("div"), rules, { p1: 0 }]) as GameRenderer;
  const internals = renderer as unknown as {
    sprites: SpriteSet; now: () => number; animate(): void; play: () => void;
    app: { renderer: { render: () => void } };
    drawn: Map<string, { sprite: Sprite; depth: Sprite; xray: Sprite | null }>;
  };
  internals.now = () => 1000;
  internals.app = { renderer: { render: () => {} } };
  internals.play = () => {};
  internals.sprites = () => ({ flip: false, art: { texture: Texture.EMPTY, silhouette: Texture.EMPTY,
    xray: Array(4).fill(Texture.EMPTY), scale: 1, anchorX: 0.5, anchorY: 1 } });
  const frame = { tick: 0, entities: [wall, { ...wall, id: "owned", owner: "p1", x: 13, ruin: undefined }],
    deposits: [], events: [], projectiles: [] } as unknown as SpectatorView;
  for (const tick of [0, 1, 0]) {
    renderer.setFrame({ ...frame, tick }, 100, true);
    internals.animate();
    const d = internals.drawn.get(wall.id)!;
    expect(d.sprite.tint).toBe(RAMPS.neutral.key);
    expect(d.depth.tint & 255).toBe(0); // cannot masquerade as player 1 for x-ray
    expect(d.xray).toBeNull();
    expect(internals.drawn.get("owned")!.sprite.tint).toBe(PLAYER_RAMPS[0].key);
  }
  const visibility = Array.from({ length: 32 }, () => "1".repeat(32));
  renderer.setFrame({ ...frame, tick: 2, visibility, entities: [{ ...wall, hp: 200 }] }, 100, true);
  internals.animate();
  const tint = internals.drawn.get(wall.id)!.sprite.tint;
  expect((tint >> 16) & 255).toBe((tint >> 8) & 255);
  expect((tint >> 8) & 255).toBe(tint & 255);
  renderer.setFrame({ ...frame, tick: 0 }, 100, true);
  internals.animate();
  expect(internals.drawn.get(wall.id)!.sprite.tint).toBe(RAMPS.neutral.key);
});
