import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Use the full-resolution accepted source, not the already dithered sprites.
// One standing reference starts every action; ability effects stay in the viewer.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sharp = createRequire(resolve(root, "packages/web/package.json"))("sharp");
const manifest = JSON.parse(await readFile(resolve(root, "assets/wizard/manifest.json"), "utf8"));
const directions = ["s", "se", "e", "ne", "n"];
for (const [view, direction] of directions.entries()) {
  const { sourceBox } = manifest.assets.find((asset: { action: string; direction: string }) => asset.action === "idle" && asset.direction === direction);
  const character = await sharp(resolve(root, "assets/wizard/source/idle.png")).extract(sourceBox)
    .resize({ height: 480, width: 400, fit: "inside" }).png().toBuffer();
  const reference = await sharp({ create: { width: 544, height: 544, channels: 4, background: "#ff00ff" } })
    .composite([{ input: character, gravity: "centre" }]).flatten({ background: "#ff00ff" }).png().toBuffer();
  for (const action of ["idle", "walk", "heal", "hack", "convert", "death"]) {
    const directory = resolve(root, `assets/animations/wizard/${action}-directions/${direction}`, ...(action === "walk" ? ["bootstrap"] : []));
    await mkdir(directory, { recursive: true });
    const target = resolve(directory, "reference.png");
    // A rerun must not silently replace a reference used by an existing take.
    // Leave room for overhead casting; the exporter restores the standing scale.
    const casting = ["heal", "hack", "convert"].includes(action);
    const input = casting ? await sharp(reference).resize(435, 435).extend({ top: 54, bottom: 55, left: 54, right: 55, background: "#ff00ff" }).png().toBuffer() : reference;
    let created = false;
    try { await writeFile(target, input, { flag: "wx" }); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    if (casting && created) {
      const path = resolve(directory, "../export-settings.json");
      let settings: { referenceScale?: Record<string, number> } = {};
      try { settings = JSON.parse(await readFile(path, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      settings.referenceScale = { ...settings.referenceScale, [direction]: 435 / 544 };
      await writeFile(path, JSON.stringify(settings, null, 2) + "\n");
    }
  }
  console.log(`Prepared Wizard ${view}: ${direction.toUpperCase()}`);
}
