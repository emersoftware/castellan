// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Graphics, Sprite, Text, Texture, TextureSource } from "pixi.js";
import { rules, type EntityView, type GameEvent, type SpectatorView } from "@castellan/shared";
import { PlayerList, UnitPanel } from "../src/components/Hud";
import { playerPerspective } from "../src/perspective";
import { PLAYER_RAMPS, RAMPS, dim } from "../src/render/palette";
import { castClip } from "../src/render/look";
import { viewFor } from "../src/render/sprites";
import atlas from "../../../assets/sprites/wizard/manifest.json";
import { createField, frameAt, stubArt } from "./support/battlefield";
vi.mock("../src/audio/sfx", () => ({ sfx: { muted: true } }));

const root = resolve(import.meta.dirname, "../../..");
const wizard: EntityView = { id: "w", kind: "wizard", owner: "a", x: 4, y: 4, hp: 45, maxHp: 45 };
const knight: EntityView = { id: "k", kind: "knight", owner: "b", x: 6, y: 4, hp: 80, maxHp: 120 };

it("draws each Wizard row facing the way it is used: SE and SW swap the mirror of the SW-facing SE row", () => {
  for (const clip of Object.values(atlas)) {
    expect(viewFor(clip.directions, 1)).toEqual({ row: 1, flip: true });
    expect(viewFor(clip.directions, 7)).toEqual({ row: 1, flip: false });
    expect(viewFor(clip.directions, 3)).toEqual({ row: 3, flip: false });
    expect(viewFor(clip.directions, 5)).toEqual({ row: 3, flip: true });
  }
  // Without a published mapping: the standard rows, the west half mirrored.
  expect([0, 1, 2, 3, 4, 5, 6, 7].map((dir) => viewFor(undefined, dir))).toEqual([0, 1, 2, 3, 4, 3, 2, 1].map((row, dir) => ({ row, flip: dir >= 5 })));
});

it("publishes the reviewed Wizard exports unchanged, with a held one-shot death", () => {
  expect(Object.keys(atlas)).toEqual(["idle", "walk", "heal", "hack", "death"]);
  for (const [action, clip] of Object.entries(atlas)) {
    const published = readFileSync(resolve(root, "assets/sprites/wizard", clip.image));
    expect(published.equals(readFileSync(resolve(root, `assets/animations/wizard/${action}-directions/export`, clip.image)))).toBe(true);
    expect(Object.keys(clip.directions)).toHaveLength(8);
  }
  expect(atlas.death).toMatchObject({ loop: false, frameHeight: 119, frameCount: 28 });
  expect(atlas.heal).toMatchObject({ loop: true, frameHeight: 112, fps: 12 });
  // Shown at the other characters' scale: every clip, death included, shrinks by the same reviewed factor.
  for (const clip of Object.values(atlas)) expect(clip).toMatchObject({ storedScale: 3, sizeFactor: 0.92 });
});

/** A 112-pixel cell stored at 3x whose visible top is a quarter down: 24.5 display pixels of body over the ground point. */
const cellArt = () => stubArt({ texture: new Texture({ source: new TextureSource({ width: 112, height: 112 }) }), scale: 1 / 3, anchorY: 0.90625, top: 0.25 });

function setup() {
  const h = createField({ ruleset: rules, colors: { a: 0, b: 1, c: 2 }, art: cellArt() });
  const lastWizard = () => h.sprites.mock.calls.filter((call) => call[0] === "wizard").at(-1)!;
  return { ...h, lastWizard };
}

it("faces its target with the heal or hack gesture only while the view shows the ability, through pause and seek", () => {
  const h = setup();
  h.field.show(frameAt(1, [wizard, knight]), 100); h.animate();
  expect(h.lastWizard()[2]?.action).toBe("idle");
  // East on the map (dx = 2) is screen direction SE.
  h.field.show(frameAt(2, [{ ...wizard, casting: { action: "heal", target: "k" } }, knight]), 100); h.animate();
  expect(h.lastWizard().slice(1, 3)).toEqual([1, expect.objectContaining({ action: "heal" })]);
  // Conversion shares the hack gesture; its target ring tells them apart.
  h.field.show(frameAt(3, [{ ...wizard, casting: { action: "convert", target: "k", progressMs: 1500 } }, knight]), 100); h.animate();
  expect(h.lastWizard()[2]?.action).toBe("hack");
  h.clock.pause(); const frozen = h.lastWizard()[2]; h.time(9000); h.animate();
  expect(h.lastWizard()[2]).toEqual(frozen);
  h.clock.resume();
  h.field.seek(frameAt(1, [wizard, knight]), 100); h.animate();
  expect(h.lastWizard()[2]?.action).toBe("idle");
});

/** The motes a casting Wizard sends, as drawn among the field's objects. */
const motes = (h: ReturnType<typeof setup>) => h.layers.objects.children.filter((child): child is Sprite => child.label === "ability-mote" && child.visible);
/** Colours stroked on the overhead layer: hearts and spirals. */
const strokes = (h: ReturnType<typeof setup>) => h.layers.fx.children.filter((child): child is Graphics => child instanceof Graphics)
  .flatMap((g) => g.context.instructions.flatMap((i) => i.action === "stroke" ? [(i.data as { style: { color: number } }).style.color] : []));
const STOPPED = dim(RAMPS.neutral.key, 0.6);
/** The overhead mark drawn with strokes (a spiral or a heart), if any. */
const overheadMark = (h: ReturnType<typeof setup>) => h.layers.fx.children.find((child): child is Graphics => child instanceof Graphics
  && child.context.instructions.some((i) => i.action === "stroke"));

it("stacks the spiral just over the visible body and its health bar, not over the transparent cell", () => {
  const h = setup();
  h.field.show(frameAt(1, [{ ...knight, hp: 120, hypno: true }]), 100); h.animate();
  const head = h.sprite("k").y - 24.5;
  const gap = () => head - overheadMark(h)!.getLocalBounds().maxY;
  expect(gap()).toBeGreaterThanOrEqual(1.5);
  expect(gap()).toBeLessThanOrEqual(3.5);
  // A health bar takes the space over the head; the spiral moves above it.
  h.field.show(frameAt(2, [{ ...knight, hp: 60, hypno: true }]), 100); h.animate();
  expect(gap()).toBeGreaterThanOrEqual(4.5);
  expect(gap()).toBeLessThanOrEqual(6.5);
});

it("sends motes from the staff among the field's objects, at the depth of the tiles they cross", () => {
  const h = setup();
  h.field.show(frameAt(1, [{ ...wizard, casting: { action: "hack", target: "k" } }, knight]), 100); h.animate();
  const sent = motes(h);
  expect(sent).toHaveLength(16);
  // Wizard at (4, 4), target at (6, 4): depths from 80 to 100, just in front of units on the same tile.
  for (const mote of sent) {
    expect(mote.zIndex).toBeGreaterThanOrEqual(86);
    expect(mote.zIndex).toBeLessThanOrEqual(106);
  }
  expect(new Set(sent.map((mote) => mote.zIndex)).size).toBeGreaterThan(1);
  expect(h.layers.fx.children.some((child) => child.label === "ability-mote")).toBe(false);
});

it("follows the measured crystal frame by frame, mirrored for the west half, with the reviewed flares", () => {
  const se = castClip("wizard", "heal", 1)!, sw = castClip("wizard", "heal", 7)!;
  const [x, y] = atlas.heal.castPoints.crystal[1][16];
  // The SE row was generated facing SW: SW draws it plain and SE mirrored, crystal included.
  expect(sw.crystal(16).x).toBeCloseTo((x - 56) * 0.92 / 3);
  expect(sw.crystal(16).y).toBeCloseTo((y - 101.5) * 0.92 / 3);
  expect(se.crystal(16)).toEqual({ x: -sw.crystal(16).x, y: sw.crystal(16).y });
  expect(se.crystal(16)).not.toEqual(se.crystal(0));
  expect(se.pulses).toEqual(atlas.heal.castPoints.pulses[1]);
  expect(castClip("knight", "heal", 1)).toBeUndefined();
});

it("bursts heal motes from the crystal at each flare and lets them travel to the target", () => {
  const h = setup();
  const healing = { ...wizard, casting: { action: "heal" as const, target: "k" } };
  const flare = atlas.heal.castPoints.pulses[1][0] * 1000 / 12;
  let shown = 0;
  for (let tick = 1; tick * 100 <= flare + 300; tick++) {
    h.time(1000 + tick * 100); h.field.show(frameAt(tick, [healing, knight]), 100); h.animate();
    if (tick * 100 < flare) expect(motes(h)).toHaveLength(0);
    else shown = Math.max(shown, motes(h).length);
  }
  expect(shown).toBeGreaterThan(0);
});

it("lets a channel's motes linger briefly when it ends on a tick, and never after a seek", () => {
  const h = setup();
  const channel = { ...wizard, casting: { action: "hack" as const, target: "k", progressMs: 2000 } };
  h.field.show(frameAt(1, [wizard, knight]), 100); h.animate();
  expect(motes(h)).toHaveLength(0);
  h.field.show(frameAt(2, [channel, knight]), 100); h.animate();
  expect(motes(h)).toHaveLength(16);
  // Stopped without a confirming event: the last motes fall grey and fade.
  h.time(1100); h.field.show(frameAt(3, [wizard, knight]), 100); h.animate();
  expect(motes(h).map((mote) => mote.tint)).toEqual(Array(16).fill(STOPPED));
  h.time(1700); h.animate();
  expect(motes(h)).toHaveLength(0);
  h.field.show(frameAt(4, [channel, knight]), 100); h.animate();
  h.field.seek(frameAt(1, [wizard, knight]), 100); h.animate();
  expect(motes(h)).toHaveLength(0);
});

it("confirms only the caster an event names, of the event's own action", () => {
  const h = setup();
  const rival: EntityView = { ...wizard, id: "r", owner: "c", y: 6 };
  const converting = (caster: EntityView) => ({ ...caster, casting: { action: "convert" as const, target: "k" } });
  h.field.show(frameAt(1, [converting(wizard), converting(rival), knight]), 100); h.animate();
  const converted: GameEvent = { tick: 1, type: "converted", id: "k", kind: "knight", owner: "a", from: "b", x: 6, y: 4, wizard: "w" };
  h.time(1100); h.field.show(frameAt(2, [wizard, rival, { ...knight, owner: "a" }], { events: [converted] }), 100); h.animate();
  const tints = motes(h).map((mote) => mote.tint);
  // The winner's motes reach the target in its colour; the rival's fall grey, never shown as a success.
  expect(tints.filter((tint) => tint === PLAYER_RAMPS[0].key)).toHaveLength(16);
  expect(tints.filter((tint) => tint === STOPPED)).toHaveLength(16);
  expect(tints).not.toContain(PLAYER_RAMPS[2].key);
});

it("shows no caster as successful when a hack's event withholds the caster", () => {
  const h = setup();
  h.field.show(frameAt(1, [{ ...wizard, casting: { action: "hack", target: "k" } }, knight]), 100); h.animate();
  const anonymous: GameEvent = { tick: 1, type: "hypno", id: "k", kind: "knight", owner: "b", x: 6, y: 4, active: true };
  h.time(1100); h.field.show(frameAt(2, [wizard, { ...knight, hypno: true }], { events: [anonymous] }), 100); h.animate();
  expect(motes(h)).toHaveLength(0);
});

it("drops a channel's ending on a seek, before it has faded", () => {
  const h = setup();
  h.field.show(frameAt(1, [wizard, knight]), 100); h.animate();
  h.field.show(frameAt(2, [{ ...wizard, casting: { action: "hack", target: "k" } }, knight]), 100); h.animate();
  h.field.show(frameAt(3, [wizard, knight]), 100); h.animate();
  expect(motes(h)).toHaveLength(16);
  h.field.seek(frameAt(3, [wizard, knight]), 100); h.animate();
  expect(motes(h)).toHaveLength(0);
});

it("marks nothing over a healed unit, spirals a hack in its controller's colour only when the view names it (neutral otherwise), never with text, and clears it with the view", () => {
  const h = setup();
  h.field.show(frameAt(1, [wizard, knight]), 100); h.animate();
  expect(strokes(h)).toEqual([]);
  h.field.show(frameAt(2, [{ ...wizard, casting: { action: "heal", target: "k" } }, knight]), 100); h.animate();
  expect(strokes(h)).toEqual([]);
  h.field.show(frameAt(3, [wizard, { ...knight, hypno: true }]), 100); h.animate();
  expect(strokes(h)).toEqual([RAMPS.neutral.key]);
  h.field.show(frameAt(4, [wizard, { ...knight, hypno: true, controller: "c" }]), 100); h.animate();
  expect(strokes(h)).toEqual([PLAYER_RAMPS[2].key]);
  expect(h.layers.fx.children.some((child) => child instanceof Text)).toBe(false);
  h.field.seek(frameAt(1, [wizard, knight]), 100); h.animate();
  expect(strokes(h)).toEqual([]);
});

it("rings a confirmed hack in neutral and a conversion in its new colour on the ground, with no text", () => {
  const h = setup();
  const rings = () => h.layers.shadows.children.filter((child): child is Graphics => child instanceof Graphics)
    .flatMap((g) => g.context.instructions.flatMap((i) => i.action === "stroke" ? [(i.data as { style: { color: number } }).style.color] : []));
  h.field.show(frameAt(1, [knight]), 100); h.animate();
  const hacked: GameEvent = { tick: 1, type: "hypno", id: "k", kind: "knight", owner: "b", x: 6, y: 4, active: true };
  h.field.show(frameAt(2, [{ ...knight, hypno: true }], { events: [hacked] }), 100); h.animate();
  expect(rings()).toEqual([RAMPS.neutral.key]);
  const converted: GameEvent = { tick: 2, type: "converted", id: "k", kind: "knight", owner: "a", from: "b", x: 6, y: 4, wizard: "w" };
  h.field.show(frameAt(3, [{ ...knight, owner: "a" }], { events: [converted] }), 100); h.animate();
  expect(rings()).toContain(PLAYER_RAMPS[0].key);
  expect(h.layers.fx.children.some((child) => child instanceof Text)).toBe(false);
  expect(h.play.mock.calls.map(([name]) => name)).toEqual(["hypno", "converted"]);
});

it("sounds a cast at each flare of its clip, and never while paused", () => {
  const h = setup();
  const casts = () => h.play.mock.calls.filter(([name]) => name === "heal").length;
  const healing = { ...wizard, casting: { action: "heal" as const, target: "k" } };
  const play = (from: number, to: number) => { for (let tick = from; tick <= to; tick++) { h.time(1000 + tick * 100); h.field.show(frameAt(tick, [healing, knight]), 100); h.animate(); } };
  // Facing SE, the clip flares once a loop at its reviewed frame; the 28-frame, 12 fps loop lasts 2333 ms.
  const flare = atlas.heal.castPoints.pulses[1][0] * 1000 / 12;
  play(1, Math.floor(flare / 100) - 1);
  expect(casts()).toBe(0);
  play(Math.floor(flare / 100), 20);
  expect(casts()).toBe(1);
  play(21, Math.ceil((flare + 2334) / 100));
  expect(casts()).toBe(2);
  h.clock.pause(); h.time(9000); h.animate();
  expect(casts()).toBe(2);
});

it("recolours a converted unit from the view, including after a seek back", () => {
  const h = setup();
  h.field.show(frameAt(1, [knight]), 100); h.animate();
  expect(h.field.entities.figures.get("k")!.tint).toBe(PLAYER_RAMPS[1].key);
  const converted: GameEvent = { tick: 1, type: "converted", id: "k", kind: "knight", owner: "a", from: "b", x: 6, y: 4, wizard: "w" };
  h.field.show(frameAt(2, [{ ...knight, owner: "a" }], { events: [converted] }), 100); h.animate();
  expect(h.field.entities.figures.get("k")!.tint).toBe(PLAYER_RAMPS[0].key);
  h.field.seek(frameAt(1, [knight]), 100); h.animate();
  expect(h.field.entities.figures.get("k")!.tint).toBe(PLAYER_RAMPS[1].key);
});

const overview = (entities: EntityView[], events: GameEvent[] = []): SpectatorView => ({
  tick: 10, timeMs: 1000, matchMs: 60000, status: "running", deposits: [], events, entities,
  players: ["a", "b", "c"].map((id, team) => ({ id, name: id, team, alive: true, popCap: 30 })),
});

it("keeps a hack's controller and its doings out of the owner's and third parties' views", () => {
  const hacked: EntityView = { ...knight, hypno: true, controller: "a", doing: "attack e9", order: "move 1,1",
    actionResult: { tick: 9, source: "script", intent: "attack e9", status: "acted" } };
  const hacking: GameEvent = { tick: 10, type: "hypno", id: "k", kind: "knight", owner: "b", x: 6, y: 4, active: true, controller: "a", wizard: "w" };
  const frame = overview([hacked, { ...wizard, casting: { action: "hack", target: "k", progressMs: 900 }, rechargeMs: 4000 }], [hacking]);
  const owner = playerPerspective(frame, "b")!, controller = playerPerspective(frame, "a")!, third = playerPerspective(frame, "c")!;
  expect(owner.entities[0]).toEqual({ ...knight, hypno: true, order: "move 1,1" });
  expect(owner.events).toEqual([{ tick: 10, type: "hypno", id: "k", kind: "knight", owner: "b", x: 6, y: 4, active: true }]);
  expect(controller.entities[0]).toEqual({ ...knight, hypno: true, controller: "a", doing: "attack e9", actionResult: hacked.actionResult });
  expect(controller.events).toEqual([hacking]);
  expect(third.entities[0]).toEqual(knight);
  expect(third.events).toEqual([]);
  // A caster's target is public, its channel time and recharge are its owner's.
  expect(owner.entities[1]).toEqual({ ...wizard, casting: { action: "hack", target: "k" } });
  expect(controller.entities[1]).toMatchObject({ casting: { progressMs: 900 }, rechargeMs: 4000 });
});

it("gives a hacked Wizard's channel time to its controller and its recharge to its owner", () => {
  const channelling: EntityView = { ...wizard, owner: "b", hypno: true, controller: "a", casting: { action: "convert", target: "k", progressMs: 1200 }, rechargeMs: 5000 };
  const frame = overview([channelling]);
  expect(playerPerspective(frame, "b")!.entities[0]).toEqual({ ...wizard, owner: "b", hypno: true, casting: { action: "convert", target: "k" }, rechargeMs: 5000 });
  expect(playerPerspective(frame, "a")!.entities[0]).toEqual({ ...wizard, owner: "b", hypno: true, controller: "a", casting: { action: "convert", target: "k", progressMs: 1200 } });
  expect(playerPerspective(frame, "c")!.entities[0]).toEqual({ ...wizard, owner: "b", casting: { action: "convert", target: "k" } });
});

it("lists and selects what a player's hacks control, and shows the owner only an anonymous mark", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const reactRoot = createRoot(host), select = vi.fn();
  const frame = overview([{ ...knight, hypno: true, controller: "a" }, wizard]);
  try {
    await act(async () => reactRoot.render(createElement(PlayerList, { view: frame, names: {}, colors: {}, onSelectUnit: select })));
    const rows = [...host.querySelectorAll("tr.hypno")].map((row) => row.textContent);
    expect(rows).toEqual(["HYPNO · controls 1:knight k", "HYPNO · 1 of its own hacked"]);
    await act(async () => host.querySelector<HTMLButtonElement>("button.hypno-unit")!.click());
    expect(select).toHaveBeenCalledWith("k");
    const owned = playerPerspective(frame, "b")!.entities[0];
    await act(async () => reactRoot.render(createElement(UnitPanel, { entity: owned, last: owned, script: { code: "self.hold();", custom: false }, tickMs: 100, viewer: "b", onClose() {} })));
    expect(host.textContent).toContain("hacked by an unknown player");
    expect(host.textContent).not.toContain("self.hold()");
    await act(async () => reactRoot.render(createElement(UnitPanel, { entity: knight, last: knight, script: { code: "self.hold();", custom: false }, tickMs: 100, viewer: "c", onClose() {} })));
    expect(host.textContent).toContain("a hack could replace it without this view showing it");
    // Switching to a view without the unit keeps its last sighting, never the observer's hack or channel.
    const observed: EntityView = { ...knight, hypno: true, controller: "a", casting: { action: "hack", target: "x", progressMs: 900 }, rechargeMs: 3000 };
    await act(async () => reactRoot.render(createElement(UnitPanel, { entity: null, last: observed, script: { code: "self.hold();", custom: false }, tickMs: 100, viewer: "b", onClose() {} })));
    expect(host.textContent).toContain("not visible from this view");
    expect(host.textContent).not.toMatch(/HYPNO|controlled by|channelled|ready in|private to the hack/);
  } finally { await act(async () => reactRoot.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
