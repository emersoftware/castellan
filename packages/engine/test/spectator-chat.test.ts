import { expect, it } from "vitest";
import { rules, MAPS } from "@aoa/shared";
import { createMatch } from "../src";

it("keeps full observer chat per player, including own private/team messages but not other conversations", async () => {
  const players = Array.from({ length: 4 }, (_, i) => ({ id: `p${i+1}`, name: `Player ${i+1}`, side: i, team: Math.floor(i/2) }));
  const m = await createMatch({ ruleset: { ...rules, map: MAPS.quad }, players, seed: 1, tickRate: 10 });
  try {
    m.step([
      { player: "p1", order: { type: "chat", text: "public" } },
      { player: "p1", order: { type: "chat", text: "our private", to: "p2" } },
      { player: "p3", order: { type: "chat", text: "their private", to: "p4" } },
      { player: "p1", order: { type: "chat", text: "our team", channel: "team" } },
    ]);
    for (let i = 0; i < 610; i++) m.step([]);
    const view = m.spectate();
    expect(view.events.filter((e) => e.type === "chat")).toHaveLength(0);
    expect(view.chat?.map((m) => m.text)).toEqual(["public"]);
    expect(view.playerChats?.p1.map((m) => m.text)).toEqual(["public", "our private", "our team"]);
    expect(view.playerChats?.p2.map((m) => m.text)).toEqual(["public", "our private", "our team"]);
    expect(view.playerChats?.p3.map((m) => m.text)).toEqual(["public", "their private"]);
    expect(m.spectate(undefined, { includePrivateChat: true }).chat).toHaveLength(4);
    expect(m.view("p1")).not.toHaveProperty("playerChats");
  } finally { m.dispose(); }
});
