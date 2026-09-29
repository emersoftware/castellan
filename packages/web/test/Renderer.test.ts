// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { v4, MAPS, type EntityView, type SpectatorView } from "@aoa/shared";
import { GameRenderer } from "../src/render/renderer";
import { TILE_H, TILE_W, type SpriteSet } from "../src/render/sprites";
import { initialDepositAmount } from "../src/render/deposits";

interface RendererInternals {
  sprites: SpriteSet;
  now: () => number;
  play: () => void;
  drawn: Map<string, { sprite: Sprite; depth: Sprite | null; xray: Sprite | null; outline: Sprite | null }>;
  fx: Container;
  effects: Array<{ update: (now: number) => boolean }>;
}

it("keeps ordinary outlines separate from building-only x-ray masks", () => {
  const renderer = Reflect.construct(GameRenderer, [document.createElement("div"), v4, { p1: 0, p2: 1 }]) as GameRenderer;
  const internal = renderer as unknown as RendererInternals & { animate(): void; app: { renderer: { render: () => void } } };
  internal.now = () => 1000;
  internal.app = { renderer: { render: () => {} } };
  internal.sprites = () => ({ flip: false, art: {
    texture: Texture.EMPTY, silhouette: Texture.EMPTY, xray: Array(4).fill(Texture.EMPTY), outline: Array(4).fill(Texture.EMPTY),
    scale: 1, anchorX: 0.5, anchorY: 1,
  } });
  const entities = ["worker", "agent", "knight", "ranger", "nexus", "turret", "wall"].flatMap((kind) =>
    ["p1", "p2"].map((owner) => ({ id: `${kind}-${owner}`, kind, owner, x: 4, y: 4, hp: 40, maxHp: 40, vital: false })),
  );
  renderer.setFrame({ tick: 1, entities, deposits: [], events: [] } as unknown as SpectatorView, 100);
  internal.animate();
  for (const e of entities) {
    const d = internal.drawn.get(e.id)!;
    const building = !!v4.kinds[e.kind].building;
    expect(!!d.xray).toBe(!building);
    expect(!!d.outline).toBe(!building);
    const tag = d.depth!.tint & 255;
    expect(Math.floor(tag / 40)).toBe(e.owner === "p1" ? 1 : 2);
    // The shader uses colour for overlap borders and this flag for x-ray.
    expect(tag % 40 === 10).toBe(building);
  }
});

it("switches mineral art and occlusion at fixed scale, including when seeking backwards", () => {
  const renderer = Reflect.construct(GameRenderer, [document.createElement("div"), v4, {}]) as GameRenderer;
  const internal = renderer as unknown as RendererInternals & { deposits: Map<string, { sprite: Sprite; depth: Sprite }> };
  const makeArt = () => ({ texture: new Texture(), silhouette: new Texture(), xray: [], scale: 1 / 3, anchorX: 0.5, anchorY: 0.68 });
  const arts = { "minerals-full": makeArt(), "minerals-half": makeArt(), "minerals-low": makeArt() };
  internal.sprites = (name) => ({ art: arts[name as keyof typeof arts], flip: false });
  internal.now = () => 1000;
  const source = v4.map.deposits[0];
  for (const [fraction, stage] of [[1, "minerals-full"], [0.6, "minerals-half"], [0.2, "minerals-low"], [0.9, "minerals-full"]] as const) {
    renderer.setFrame({ tick: 1, entities: [], events: [], deposits: [{ ...source, id: "d1", amount: source.amount * fraction }] } as unknown as SpectatorView, 100, true);
    const d = internal.deposits.get("d1")!;
    expect(d.sprite.texture).toBe(arts[stage].texture);
    expect(d.depth.texture).toBe(arts[stage].silhouette);
    expect(d.sprite.scale.x).toBe(1 / 3);
    expect(d.sprite.anchor.y).toBe(0.68);
    expect(d.sprite.tint).toBe(0xffffff);
  }
});

it("uses each deposit's capacity across every rotated quad seat and shared deposits", () => {
  const map = MAPS.quad;
  for (const d of map.deposits) {
    for (const [x, y] of [[d.x, d.y], [63 - d.x, 63 - d.y], [63 - d.y, d.x], [d.y, 63 - d.x]]) {
      expect(initialDepositAmount(map, { id: "test", x, y, amount: 1 })).toBe(d.amount);
    }
  }
  for (const d of map.sharedDeposits) expect(initialDepositAmount(map, { ...d, id: "shared", amount: 1 })).toBe(d.amount);
});

it.each(["shooter", "target"])("places a newly spawned or revealed %s before drawing its first arrow", (newEntity) => {
  // Replay aca7a69c, tick 669: A1's ranger spawns and attacks four tiles away.
  // Construct real Pixi scene objects without starting a browser/GPU ticker.
  const renderer = Reflect.construct(GameRenderer, [document.createElement("div"), v4, { p1: 0, p4: 3 }]) as GameRenderer;
  const internal = renderer as unknown as RendererInternals;
  internal.now = () => 1000;
  internal.play = () => {};
  internal.sprites = () => ({ flip: false, art: {
    texture: Texture.EMPTY, silhouette: Texture.EMPTY, xray: Array(4).fill(Texture.EMPTY),
    scale: 1, anchorX: 0.5, anchorY: 1,
  } });
  const shooter: EntityView = { id: "e43", kind: "ranger", owner: "p1", x: 59, y: 60, hp: 50, maxHp: 50, vital: false };
  const target: EntityView = { id: "e34", kind: "worker", owner: "p4", x: 55, y: 61, hp: 2, maxHp: 40, vital: false };
  const existing = newEntity === "shooter" ? target : shooter;
  const frame = { tick: 669, entities: [existing], deposits: [], events: [] } as unknown as SpectatorView;
  renderer.setFrame(frame, 100);
  // The already-visible unit has been positioned by a previous animation tick.
  internal.drawn.get(existing.id)!.sprite.position.set((existing.x - existing.y) * TILE_W / 2, (existing.x + existing.y) * TILE_H / 2 + 3);
  renderer.setFrame({ ...frame, tick: 670, entities: [shooter, target], events: [
    { tick: 669, type: "attack", from: shooter.id, to: target.id, dmg: 13 },
  ] }, 100);
  const arrow = internal.fx.children.at(-1) as Graphics;
  const lineTo = vi.spyOn(arrow, "lineTo");
  const a = { x: (shooter.x - shooter.y) * TILE_W / 2, y: (shooter.x + shooter.y) * TILE_H / 2 + 3 - internal.drawn.get(shooter.id)!.sprite.height * 0.7 };
  const b = { x: (target.x - target.y) * TILE_W / 2, y: (target.x + target.y) * TILE_H / 2 + 3 - 6 };
  const effect = internal.effects.at(-1)!;
  effect.update(1000);
  expect(lineTo).toHaveBeenLastCalledWith(a.x, a.y);
  effect.update(1110);
  expect(lineTo).toHaveBeenLastCalledWith((a.x + b.x) / 2, (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
});

it("renders real projectile state on seeks, interpolates it, and removes it on impact or fog loss", () => {
  const renderer = Reflect.construct(GameRenderer, [document.createElement("div"), v4, {}]) as GameRenderer;
  let now = 1000;
  const internal = renderer as unknown as RendererInternals & {
    shots: Map<string, { graphic: Graphics; from: { x: number; y: number }; to: { x: number; y: number } }>;
    animate(): void; app: { renderer: { render: () => void } };
  };
  internal.now = () => now;
  internal.app = { renderer: { render: () => {} } };
  const p = { id: "p1", owner: "a", x: 3, y: 4, vx: 6, vy: 0, endX: 6, endY: 4 };
  const frame = { tick: 2, entities: [], deposits: [], events: [], projectiles: [p] } as unknown as SpectatorView;
  renderer.setFrame(frame, 100, true);
  const shot = internal.shots.get("p1")!;
  const line = vi.spyOn(shot.graphic, "lineTo");
  renderer.setFrame({ ...frame, projectiles: [{ ...p, x: 3.6 }] }, 100);
  now = 1050;
  internal.animate();
  expect(line).toHaveBeenLastCalledWith((3.3 - 4) * TILE_W / 2, (3.3 + 4) * TILE_H / 2 - 6);
  renderer.setFrame({ ...frame, projectiles: [], events: [{ type: "projectile_end", tick: 2, id: "p1", x: 5.65, y: 4, dmg: 12, reason: "hit" }] }, 100);
  expect(internal.shots.size).toBe(0);
  expect(shot.graphic.destroyed).toBe(true);
  renderer.setFrame(frame, 100, true);
  expect(internal.shots.get("p1")!.to.x).toBe(3);
  renderer.setFrame({ ...frame, projectiles: [] }, 100);
  expect(internal.shots.size).toBe(0);
});
