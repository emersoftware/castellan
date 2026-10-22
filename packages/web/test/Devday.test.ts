import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";

const deck = new URL("../public/devday/", import.meta.url);

it("navigates every public slide forward and back without speaker notes or a presenter", () => {
  const dom = new JSDOM(readFileSync(new URL("index.html", deck), "utf8"), {
    url: "https://example.test/devday/", runScripts: "outside-only",
  });
  const { window } = dom;
  try {
    expect(window.document.querySelector("#presenter-open, [data-cues], script[src='notes.js']")).toBeNull();
    Object.defineProperty(window, "matchMedia", { value: () => ({ matches: true, addEventListener() {} }) });
    window.HTMLMediaElement.prototype.pause = () => {};
    const open = vi.spyOn(window, "open");
    window.eval(readFileSync(new URL("slides.js", deck), "utf8"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    const talk = (window as unknown as { talk: {
      state: { id: string; step: number }; next(): void; prev(): void;
    } }).talk;
    const scenes = [...window.document.querySelectorAll<HTMLElement>("#deck > .scene")];
    const moments = scenes.flatMap(s => Array.from({ length: Number(s.dataset.steps) || 1 }, (_, step) => ({ id: s.id, step })));
    expect(moments.length).toBeGreaterThan(scenes.length);
    for (const moment of moments) {
      expect(talk.state).toMatchObject(moment);
      expect(window.document.querySelector(".scene.active")?.id).toBe(moment.id);
      talk.next();
    }
    for (const moment of [...moments].reverse()) {
      expect(talk.state).toMatchObject(moment);
      talk.prev();
    }
    window.document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "P", bubbles: true }));
    expect(open).not.toHaveBeenCalled();
    expect(window.document.querySelectorAll("#overview-list button")).toHaveLength(scenes.length);
  } finally { window.close(); }
});
