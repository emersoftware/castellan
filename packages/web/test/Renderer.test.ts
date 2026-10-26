// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { Container, FilterSystem, Graphics, RenderTexture, Texture, TextureSource, type Filter } from "pixi.js";
import { rules, MAPS, seatToMap, type EntityView } from "@castellan/shared";
import { OcclusionPass } from "../src/render/occlusion";
import { TILE_H, TILE_W } from "../src/render/sprites";
import { initialDepositAmount } from "../src/render/deposits";
import { createField, frameAt, stubArt } from "./support/battlefield";
import { playerColors } from "../src/api";
import { PLAYER_RAMPS, RAMPS } from "../src/render/palette";

it("gives six players distinct body colours and recolours a conversion to the sixth player", () => {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}` }));
  const colors = playerColors(players);
  const h = createField({ colors });
  const entities = players.map(({ id }, i) => ({ id, owner: id, kind: "knight", x: 4 + i, y: 4, hp: 40, maxHp: 40 }));
  h.field.show(frameAt(1, entities), 100);
  h.animate();
  const tints = players.map(p => h.sprite(p.id).tint);
  expect(new Set(tints).size).toBe(6);
  expect(tints).toEqual(PLAYER_RAMPS.map(ramp => ramp.key));
  expect(tints.every(tint => ![RAMPS.fire.key, RAMPS.terrain.key, RAMPS.mineral.key, RAMPS.neutral.key].includes(tint))).toBe(true);
  h.field.show(frameAt(2, entities.map(e => e.id === "p1" ? { ...e, owner: "p6" } : e)), 100);
  h.animate();
  expect(h.sprite("p1").tint).toBe(tints[5]);
  for (const layer of Object.values(h.layers)) layer.destroy({ children: true });
});

it("falls back to the screen resolution after a pooled filter texture is pruned", () => {
  const texture = RenderTexture.create({ width: 800, height: 600 });
  const system = Object.create(FilterSystem.prototype) as {
    _filterStackIndex: number;
    _filterStack: Array<{ skip: boolean; inputTexture: Texture }>;
    _findFilterResolution(resolution: number): number;
  };
  system._filterStackIndex = 2;
  system._filterStack = [{ skip: false, inputTexture: texture }, { skip: false, inputTexture: texture }];
  texture.destroy(true);
  expect(system._findFilterResolution(1)).toBe(1);
});

it("keeps the depth source held by filters alive when the viewport changes", () => {
  const xrayLayer = new Container(), outlineLayer = new Container();
  const pass = new OcclusionPass(xrayLayer, outlineLayer);
  pass.resize(800, 600);
  const resources = (layer: Container) => (layer.filters as Filter[])[0].resources as { uDepth: TextureSource; xrayUniforms: { uniforms: { uScreen: Float32Array } } };
  const source = resources(xrayLayer).uDepth;
  pass.resize(390, 600);
  expect(resources(xrayLayer).uDepth).toBe(source);
  expect(source.destroyed).toBe(false);
  expect(source.width).toBe(390);
  expect(resources(outlineLayer).uDepth).toBe(source);
  expect([...resources(outlineLayer).xrayUniforms.uniforms.uScreen]).toEqual([390, 600]);
});

it("keeps ordinary outlines separate from building-only x-ray masks", () => {
  const h = createField({ colors: { p1: 0, p2: 1 }, art: stubArt({ outline: Array(4).fill(Texture.EMPTY) }) });
  // Each entity on its own tile, so each has its own depth.
  const entities = ["worker", "king", "knight", "archer", "castle", "tower", "wall"].flatMap((kind, i) =>
    ["p1", "p2"].map((owner, j) => ({ id: `${kind}-${owner}`, kind, owner, x: 4 + i * 2 + j, y: 4, hp: 40, maxHp: 40, vital: false })),
  );
  h.field.show(frameAt(1, entities), 100);
  h.animate();
  for (const e of entities) {
    const sprite = h.sprite(e.id);
    const building = !!rules.kinds[e.kind].building;
    // Units carry x-ray and outline bodies at their depth; buildings only a silhouette.
    expect(h.layers.xray.children.some((c) => c.zIndex === -sprite.zIndex)).toBe(!building);
    expect(h.layers.outlines.children.some((c) => c.zIndex === sprite.zIndex)).toBe(!building);
    const tag = h.occluderOf(sprite)!.tint & 255;
    expect(Math.floor(tag / 40)).toBe(e.owner === "p1" ? 1 : 2);
    // The shader uses colour for overlap borders and this flag for x-ray.
    expect(tag % 40 === 10).toBe(building);
  }
});

it("switches mineral art and occlusion at fixed scale, including when seeking backwards", () => {
  const makeArt = () => stubArt({ texture: new Texture(), silhouette: new Texture(), xray: [], scale: 1 / 3, anchorX: 0.5, anchorY: 0.68 });
  const arts = { "minerals-full": makeArt(), "minerals-half": makeArt(), "minerals-low": makeArt() };
  const h = createField({ sprites: (name) => ({ art: arts[name as keyof typeof arts] ?? stubArt(), flip: false }) });
  const source = rules.map.deposits[0];
  for (const [fraction, stage] of [[1, "minerals-full"], [0.6, "minerals-half"], [0.2, "minerals-low"], [0.9, "minerals-full"]] as const) {
    h.field.seek(frameAt(1, [], { deposits: [{ ...source, id: "d1", amount: source.amount * fraction }] }), 100);
    h.animate();
    const sprite = h.field.deposits.figures.get("d1")!.sprite;
    expect(sprite.texture).toBe(arts[stage].texture);
    expect(h.occluderOf(sprite)!.texture).toBe(arts[stage].silhouette);
    expect(sprite.scale.x).toBe(1 / 3);
    expect(sprite.anchor.y).toBe(0.68);
    expect(sprite.tint).toBe(0xffffff);
  }
});

it("uses each deposit's capacity across every rotated quad seat and shared deposits", () => {
  const map = MAPS.quad;
  const last = map.width - 1;
  for (const d of map.deposits) {
    for (const [x, y] of [[d.x, d.y], [last - d.x, last - d.y], [last - d.y, d.x], [d.y, last - d.x]]) {
      expect(initialDepositAmount(map, { id: "test", x, y, amount: 1 })).toBe(d.amount);
    }
  }
  for (const d of map.sharedDeposits) expect(initialDepositAmount(map, { ...d, id: "shared", amount: 1 })).toBe(d.amount);
});

it("retains mineral capacities at all six rotated origins after mining", () => {
  const map = MAPS.hex;
  for (const [seat] of map.origins!.entries()) for (const deposit of map.deposits) {
    const [x, y] = seatToMap(deposit.x, deposit.y, seat, map.width, map.height, map.origins);
    expect(initialDepositAmount(map, { id: "mined", x, y, amount: 1 })).toBe(deposit.amount);
  }
});

it.each(["shooter", "target"])("places a newly spawned or revealed %s before drawing its first arrow", (newEntity) => {
  // Replay aca7a69c, tick 669: A1's archer spawns and attacks four tiles away.
  const h = createField({ colors: { p1: 0, p4: 3 } });
  const shooter: EntityView = { id: "e43", kind: "archer", owner: "p1", x: 59, y: 60, hp: 50, maxHp: 50, vital: false };
  const target: EntityView = { id: "e34", kind: "worker", owner: "p4", x: 55, y: 61, hp: 2, maxHp: 40, vital: false };
  const existing = newEntity === "shooter" ? target : shooter;
  h.field.show(frameAt(669, [existing]), 100);
  // The already-visible unit has been positioned by a previous animation tick.
  h.animate();
  h.field.show(frameAt(670, [shooter, target], { events: [{ tick: 669, type: "attack", from: shooter.id, to: target.id, dmg: 13 }] }), 100);
  const arrow = h.layers.fx.children.at(-1) as Graphics;
  const lineTo = vi.spyOn(arrow, "lineTo");
  const a = { x: (shooter.x - shooter.y) * TILE_W / 2, y: (shooter.x + shooter.y) * TILE_H / 2 + 3 - h.sprite(shooter.id).height * 0.7 };
  const b = { x: (target.x - target.y) * TILE_W / 2, y: (target.x + target.y) * TILE_H / 2 + 3 - 6 };
  h.animate();
  expect(lineTo).toHaveBeenLastCalledWith(a.x, a.y);
  h.time(1110);
  h.animate();
  expect(lineTo).toHaveBeenLastCalledWith((a.x + b.x) / 2, (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.18);
});

it("fires a building's shot from near its top and brings it down to the usual height by its end", () => {
  // A 60-pixel-tall building whose art is solid from the top: its visible body is 60 display pixels high.
  const h = createField({ colors: { a: 0, b: 1 }, art: stubArt({ texture: new Texture({ source: new TextureSource({ width: 100, height: 60 }) }) }) });
  const castle: EntityView = { id: "c", kind: "castle", owner: "a", x: 2, y: 4, hp: 1000, maxHp: 1000 };
  const target: EntityView = { id: "w", kind: "worker", owner: "b", x: 6, y: 4, hp: 40, maxHp: 40 };
  const p = { id: "p1", owner: "a", x: 2.5, y: 4, vx: 6, vy: 0, endX: 6, endY: 4 };
  h.field.show(frameAt(1, [castle, target]), 100); h.animate();
  h.field.show(frameAt(2, [castle, target], { projectiles: [p], events: [{ tick: 1, type: "attack", from: "c", to: "w", dmg: 12, projectile: "p1" }] }), 100);
  const streak = h.layers.fx.children.at(-1) as Graphics;
  const line = vi.spyOn(streak, "lineTo");
  h.time(1100); h.animate();
  expect(line).toHaveBeenLastCalledWith((2.5 - 4) * TILE_W / 2, (2.5 + 4) * TILE_H / 2 - 48);
  h.field.show(frameAt(3, [castle, target], { projectiles: [{ ...p, x: 6 }] }), 100);
  h.time(1200); h.animate();
  expect(line).toHaveBeenLastCalledWith((6 - 4) * TILE_W / 2, (6 + 4) * TILE_H / 2 - 6);
});

it("renders real projectile state on seeks, interpolates it, and removes it on impact or fog loss", () => {
  const h = createField();
  const p = { id: "p1", owner: "a", x: 3, y: 4, vx: 6, vy: 0, endX: 6, endY: 4 };
  const frame = frameAt(2, [], { projectiles: [p] });
  h.field.seek(frame, 100);
  const streak = h.layers.fx.children[0] as Graphics;
  const line = vi.spyOn(streak, "lineTo");
  h.field.show({ ...frame, projectiles: [{ ...p, x: 3.6 }] }, 100);
  h.time(1050);
  h.animate();
  expect(line).toHaveBeenLastCalledWith((3.3 - 4) * TILE_W / 2, (3.3 + 4) * TILE_H / 2 - 6);
  h.field.show({ ...frame, projectiles: [], events: [{ type: "projectile_end", tick: 2, id: "p1", x: 5.65, y: 4, dmg: 12, reason: "hit" }] }, 100);
  expect(streak.destroyed).toBe(true);
  // A seek shows the recorded position, not one interpolated from the last streak.
  h.field.seek(frame, 100);
  const again = h.layers.fx.children.at(-1) as Graphics;
  const lineAgain = vi.spyOn(again, "lineTo");
  h.animate();
  expect(lineAgain).toHaveBeenLastCalledWith((3 - 4) * TILE_W / 2, (3 + 4) * TILE_H / 2 - 6);
  h.field.show({ ...frame, projectiles: [] }, 100);
  expect(again.destroyed).toBe(true);
});
