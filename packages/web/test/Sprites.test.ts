// @vitest-environment jsdom
import { expect, it } from "vitest";
import { Texture, TextureSource } from "pixi.js";
import { animationCell, cropSpriteArt } from "../src/render/sprites";

it("crops unwanted source fragments from every layer without shifting the ground anchor", () => {
  const texture = new Texture({ source: new TextureSource({ width: 128, height: 182 }) });
  const tower = { anchorX: 0.6171875, anchorY: 0.8934065934065936, frame: { x: 45, y: 0, width: 83, height: 182 } };
  const art = { texture, silhouette: texture, xray: Array(4).fill(texture), scale: 1 / 3, anchorX: tower.anchorX, anchorY: tower.anchorY };
  const cropped = cropSpriteArt(art, tower.frame);
  for (const layer of [cropped.texture, cropped.silhouette, ...cropped.xray]) {
    // The source's unwanted fragment occupies columns 0–40; the tower starts at 50.
    expect(layer.frame.x).toBeGreaterThan(40);
    expect(layer.frame.x).toBeLessThan(50);
    expect(layer.frame.right).toBe(128);
    expect(layer.frame.height).toBe(182);
    expect(layer.source).toBe(texture.source);
  }
  // A source pixel must retain the same world position after the crop.
  const worldXBefore = (90 - art.anchorX * texture.width) * art.scale;
  const worldXAfter = (90 - tower.frame.x - cropped.anchorX * cropped.texture.width) * cropped.scale;
  expect(worldXAfter).toBeCloseTo(worldXBefore);
  expect(cropped.anchorY).toBe(art.anchorY);
});

it("shares atlas sources across frames and preserves cell anchors in every pass", () => {
  const texture = new Texture({ source: new TextureSource({ width: 3136, height: 560 }) });
  const art = { texture, silhouette: texture, xray: Array(4).fill(texture), outline: Array(4).fill(texture), scale: 1 / 3, anchorX: 0.5, anchorY: 0.90625 };
  const frame = { x: 19 * 112, y: 4 * 112, width: 112, height: 112 };
  const cell = animationCell(art, frame);
  expect(cell.anchorX).toBe(art.anchorX);
  expect(cell.anchorY).toBe(art.anchorY);
  expect(cell.scale).toBe(art.scale);
  for (const layer of [cell.texture, cell.silhouette, ...cell.xray, ...cell.outline!]) {
    expect(layer.source).toBe(texture.source);
    expect(layer.frame).toMatchObject(frame);
  }
});

it("keeps a reduced odd-sized animation cell at its original world size and ground anchor", () => {
  const texture = new Texture({ source: new TextureSource({ width: 28 * 56, height: 5 * 60 }) });
  const art = { texture, silhouette: texture, xray: Array(4).fill(texture), outline: Array(4).fill(texture), scale: 1 / 1.5, anchorX: 0.5, anchorY: 0.8529411764705882 };
  const cell = animationCell(art, { x: 56, y: 60, width: 56, height: 60, displayWidth: 56, displayHeight: 59.5 });
  for (const layer of [cell.texture, cell.silhouette, ...cell.xray, ...cell.outline!]) {
    expect(layer.frame.height).toBe(60);
    expect(layer.height * cell.scale).toBe(119 / 3);
    expect(layer.height * cell.anchorY * cell.scale).toBeCloseTo(119 * art.anchorY / 3);
  }
});
