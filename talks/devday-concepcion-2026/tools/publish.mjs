// Copies the deck into the site build, so it ships with rts.emersoftware.cl at /devday/.
// Run after the web build: node talks/devday-concepcion-2026/tools/publish.mjs
import { cp, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const deck = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(deck, "../../packages/web/dist/devday");
const RUNTIME = ["index.html", "slides.css", "slides.js", "scenes.js", "game.js", "assets"];
const SKIP = [/^assets\/portada-anim(\/|$)/, /^assets\/portada-reyes(?!-v11\.png).*\.png$/];

await rm(out, { recursive: true, force: true });
for (const item of RUNTIME) {
  await cp(join(deck, item), join(out, item), {
    recursive: true,
    filter: src => !SKIP.some(re => re.test(relative(deck, src).split(sep).join("/"))),
  });
}
console.log(`deck → ${relative(process.cwd(), out)}`);
