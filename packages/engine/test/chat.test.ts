import { describe, expect, it } from "vitest";
import { v0, type Order } from "@aoa/shared";
import { createMatch } from "../src";

describe("chat validation", () => {
  it("rejects team chat without a teammate and invalid payloads without emitting messages", async () => {
    const m = await createMatch({ ruleset: v0, players: [{ id: "p1", name: "a" }, { id: "p2", name: "b" }], seed: 1, tickRate: 10 });
    try {
      const invalid = [
        { text: "secret", channel: "team" },
        { text: "secret", channel: "p2" },
        { text: "secret", channel: null },
        { text: "secret", channel: {} },
        { text: "secret", to: "missing" },
        { text: "secret", to: "p1" },
        { text: "secret", to: null },
        { text: "secret", to: ["p2"] },
        { text: "secret", channel: "private" },
        { text: "secret", channel: "team", to: "p2" },
        { text: "secret", channel: "all", to: "p2" },
        { text: " " },
        { text: "x".repeat(201) },
      ];
      for (const payload of invalid) {
        const result = m.step([{ player: "p1", order: { type: "chat", ...payload } as Order }]);
        expect(result.results[0].ok).toBe(false);
        expect(result.events.some((e) => e.type === "chat")).toBe(false);
      }
      const result = m.step([{ player: "p1", order: { type: "chat", text: " hello " } }]);
      expect(result.results).toEqual([{ ok: true }]);
      expect(m.view("p2", 0).events).toContainEqual(expect.objectContaining({ type: "chat", text: "hello" }));
    } finally {
      m.dispose();
    }
  });
});
