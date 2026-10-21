// Copies the deck into the site build, so it ships with rts.emersoftware.cl at /devday/.
// Run after the web build: node talks/devday-concepcion-2026/tools/publish.mjs
import { cp, readFile, rm, writeFile } from "node:fs/promises";
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
// Public deck: no presenter view and no speaker notes.
const page = join(out, "index.html");
const html = (await readFile(page, "utf8"))
  .replace(/\s*<button id="presenter-open"[^>]*>[^<]*<\/button>/, "")
  .replace(/\s*<script src="notes\.js"><\/script>/, "");
await writeFile(page, html);
console.log(`deck → ${relative(process.cwd(), out)}`);
