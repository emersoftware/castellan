import { afterEach, describe, expect, it, vi } from "vitest";
import { rules, MAPS, viewToText, type GameEvent, type ReplayFile, type SpectatorMessage } from "@castellan/shared";
import { runReplay } from "@castellan/engine";
import { Room } from "../src/room";

let room: Room;
afterEach(() => {
  room?.close();
  vi.useRealTimers();
});

async function start(chat = true, mode?: "ffa", matchMs = 5000) {
  const replays: ReplayFile[] = [];
  room = await Room.create({
    // Whole-map sight, so every player's units show up in each view.
    ruleset: { ...rules, map: MAPS.quad, matchMs, fourSeatMatchMs: matchMs,
      kinds: Object.fromEntries(Object.entries(rules.kinds).map(([k, s]) => [k, { ...s, vision: 44 }])) },
    // Deliberately interleaved: privacy must follow team, not seat/list order.
    players: [0, 1, 0, 1].map((team, i) => ({ name: `player${i}`, team: mode === "ffa" ? undefined : team })),
    mode,
    tickRate: 10, seed: 1, sides: "random", prepMs: 0, botLatencyMs: 1000, chat,
    onFinish: (replay) => replays.push(replay),
  });
  vi.useFakeTimers();
  for (const p of room.players) room.touch(p.id);
  await vi.advanceTimersByTimeAsync(0);
  return replays;
}

describe("team chat privacy", () => {
  it("shares the per-tick order limit across concurrent action calls", async () => {
    await start();
    const unit = room.view("p1").mine.find((e) => e.kind === "king")!.id;
    const orders = Array.from({ length: 30 }, () => ({ type: "stop" as const, unit }));
    const first = room.act("p1", orders);
    const second = room.act("p1", orders);
    await vi.advanceTimersByTimeAsync(100);
    const results = (await Promise.all([first, second])).flatMap((r) => r.results);
    expect(results.filter((r) => r.ok)).toHaveLength(50);
    expect(results.filter((r) => !r.ok)).toEqual(Array.from({ length: 10 }, () => ({ ok: false, reason: "over 50 orders this tick" })));
  });

  it("shows only the last five visible messages while preserving the full conversation", async () => {
    await start(true, "ffa", 30000);
    for (let i = 0; i < 7; i++) {
      const visible = room.act("p1", [{ type: "chat", text: `visible-${i}`, ...(i % 2 ? { to: "p2" } : {}) }]);
      const hidden = room.act("p3", [{ type: "chat", to: "p4", text: `hidden-${i}` }]);
      await vi.advanceTimersByTimeAsync(100);
      expect((await visible).results[0].ok).toBe(true);
      expect((await hidden).results[0].ok).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
    }
    for (const since of [0, room.tick, room.tick + 100]) {
      const view = room.view("p2", since);
      expect(view.chat?.messages.map((m) => m.text)).toEqual(["visible-2", "visible-3", "visible-4", "visible-5", "visible-6"]);
      const json = JSON.stringify(view);
      expect(json).not.toContain("hidden-");
      expect(json).not.toContain("visible-0");
      expect(json).not.toContain("visible-1");
      const rendered = viewToText(view);
      expect(rendered.match(/visible-\d/g)).toHaveLength(5);
      expect(rendered).toContain("Use chat without text to read the full visible history.");
    }
    expect(room.conversation("p2").map((m) => m.text)).toEqual(Array.from({ length: 7 }, (_, i) => `visible-${i}`));
  });

  it("keeps chat in state across cursors and a busy event summary", async () => {
    await start();
    const sent = room.act("p1", [{ type: "chat", text: "public opening" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await sent).results[0].ok).toBe(true);
    for (const p of room.players) {
      const last = room.view(p.id);
      const view = room.view(p.id, last.tick);
      expect(view.events.some((e) => e.type === "chat")).toBe(false);
      expect(view.chat).toEqual({ enabled: true, messages: [expect.objectContaining({ from: "p1", text: "public opening" })] });
      // More events than the text renderer's cap must not bury the chat.
      view.events = Array.from({ length: 40 }, (_, i) => ({ tick: i, type: "order_end", id: `unit${i}`, owner: p.id, reason: "completed" }));
      expect(viewToText(view)).toContain("public opening");
      expect(room.view(p.id, room.tick + 100).chat).toEqual(view.chat);
    }
  });

  it("delivers direct messages only to sender and recipient in FFA, then replays them", async () => {
    const replays = await start(true, "ffa");
    expect(new Set(room.players.map((p) => p.team)).size).toBe(4);
    expect(room.teams).toBe(false);
    expect(room.view("p1").allies).toEqual([]);
    expect(new Set(room.view("p1").enemy.map((e) => e.owner)).size).toBe(3);
    const ffaView = room.view("p1");
    const textLines = viewToText(ffaView).split("\n");
    for (const entity of ffaView.enemy) {
      expect(textLines.find((line) => line.startsWith(`  ${entity.id} `))).toContain(`owner ${entity.owner}`);
    }
    const frames: SpectatorMessage[] = [];
    room.addSpectator({ send: (frame) => frames.push(frame) });
    const recipientWake = vi.fn();
    const otherWake = vi.fn();
    const recipientWait = room.wait("p2", 0, 2000, ["chat"]).then(recipientWake);
    const otherWait = room.wait("p3", 0, 2000, ["chat"]).then(otherWake);
    const sent = room.act("p1", [{ type: "chat", to: "p2", text: "private pact" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await sent).results).toEqual([{ ok: true }]);
    await recipientWait;
    expect(recipientWake).toHaveBeenCalledOnce();
    expect(otherWake).not.toHaveBeenCalled();
    for (const p of ["p1", "p2"]) {
      expect(room.view(p, 0).events).toContainEqual(expect.objectContaining({ channel: "private", to: "p2", text: "private pact" }));
      expect(room.conversation(p)).toHaveLength(1);
    }
    for (const p of ["p3", "p4"]) {
      expect(room.view(p, 0).events.some((e) => e.type === "chat")).toBe(false);
      expect(room.conversation(p)).toEqual([]);
    }
    const lateWake = vi.fn();
    const lateWait = room.wait("p4", 0, 2000, ["chat"]).then(lateWake);
    await vi.advanceTimersByTimeAsync(100);
    expect(lateWake).not.toHaveBeenCalled();
    expect(JSON.stringify({ events: room.spectate(0).events, chat: room.spectate(0).chat })).not.toContain("private pact");
    expect(room.spectate(0).playerChats?.p1).toContainEqual(expect.objectContaining({ text: "private pact" }));
    expect(room.spectate(0).playerChats?.p3).toEqual([]);
    expect((await room.act("p1", [{ type: "chat", text: "again" }])).results[0]).toMatchObject({ ok: false, reason: "one message every 3s" });
    const reply = room.act("p2", [{ type: "chat", channel: "private", to: "p1", text: "agreed" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await reply).results).toEqual([{ ok: true }]);
    expect(room.conversation("p1").at(-1)).toMatchObject({ from: "p2", to: "p1", text: "agreed" });
    expect(otherWake).not.toHaveBeenCalled();
    const publicSent = room.act("p3", [{ type: "chat", text: "hello all" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await publicSent).results).toEqual([{ ok: true }]);
    await Promise.all([otherWait, lateWait]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(replays).toHaveLength(1);
    const replayChat: GameEvent[] = [];
    expect(await runReplay(replays[0], (frame) => replayChat.push(...frame.events.filter((e) => e.type === "chat")))).toEqual({ verified: true, desyncAt: undefined });
    expect(replayChat).toEqual([
      { tick: 1, type: "chat", owner: "p1", channel: "private", to: "p2", text: "private pact" },
      { tick: 3, type: "chat", owner: "p2", channel: "private", to: "p1", text: "agreed" },
      { tick: 4, type: "chat", owner: "p3", text: "hello all" },
    ]);
    expect(JSON.stringify(frames.map((f) => ({ events: f.view.events, chat: f.view.chat })))).not.toContain("private pact");
    expect(JSON.stringify(frames.map((f) => ({ events: f.view.events, chat: f.view.chat })))).not.toContain("agreed");
  });

  it("does not share a direct message with either player's teammates", async () => {
    await start();
    const sent = room.act("p1", [{ type: "chat", to: "p2", text: "between enemies" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await sent).results).toEqual([{ ok: true }]);
    for (const p of ["p1", "p2"]) expect(room.conversation(p)).toHaveLength(1);
    for (const p of ["p3", "p4"]) {
      expect(room.conversation(p)).toEqual([]);
      expect(room.view(p).chat?.messages).toEqual([]);
      expect(room.view(p, 0).events.some((e) => e.type === "chat")).toBe(false);
    }
  });

  it("keeps team chat private live and includes it in the finished replay", async () => {
    const replays = await start();
    const frames: SpectatorMessage[] = [];
    room.addSpectator({ send: (frame) => frames.push(frame) });
    const allyWake = vi.fn();
    const enemyWake = vi.fn();
    const allyWait = room.wait("p3", room.tick, 2000, ["chat"]).then(allyWake);
    const enemyWait = room.wait("p2", room.tick, 2000, ["chat"]).then(enemyWake);
    const sent = room.act("p1", [{ type: "chat", channel: "team", text: "secret north attack" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await sent).results).toEqual([{ ok: true }]);
    await allyWait;
    expect(allyWake).toHaveBeenCalledOnce();
    expect(enemyWake).not.toHaveBeenCalled();
    for (const player of ["p1", "p3"]) {
      expect(room.view(player, 0).events).toContainEqual(expect.objectContaining({ type: "chat", channel: "team", text: "secret north attack" }));
      expect(room.conversation(player)).toHaveLength(1);
      expect(room.view(player).chat?.messages).toContainEqual(expect.objectContaining({ text: "secret north attack" }));
    }
    for (const player of ["p2", "p4"]) {
      expect(room.view(player, 0).events.some((e) => e.type === "chat")).toBe(false);
      expect(room.conversation(player)).toEqual([]);
      expect(room.view(player).chat?.messages).toEqual([]);
    }
    // A waiter registered after the message must also ignore the hidden event.
    const lateEnemyWake = vi.fn();
    const lateWait = room.wait("p4", 0, 2000, ["chat"]).then(lateEnemyWake);
    await vi.advanceTimersByTimeAsync(100);
    expect(lateEnemyWake).not.toHaveBeenCalled();
    expect(JSON.stringify(frames.map((f) => ({ events: f.view.events, chat: f.view.chat })))).not.toContain("secret north attack");
    expect(JSON.stringify({ events: room.spectate(0).events, chat: room.spectate(0).chat })).not.toContain("secret north attack");
    expect(room.spectate(0).playerChats?.p3).toContainEqual(expect.objectContaining({ text: "secret north attack" }));
    expect(room.spectate(0).playerChats?.p2).toEqual([]);

    // Existing public chat still reaches everyone and is recorded.
    const publicSent = room.act("p2", [{ type: "chat", text: "hello everyone" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await publicSent).results).toEqual([{ ok: true }]);
    await Promise.all([enemyWait, lateWait]);
    for (const p of room.players) expect(room.conversation(p.id)).toContainEqual(expect.objectContaining({ text: "hello everyone" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(replays).toHaveLength(1);
    expect(JSON.stringify(replays[0])).toContain("secret north attack");
    expect(JSON.stringify(replays[0])).toContain("hello everyone");
    const replayChat: GameEvent[] = [];
    expect(await runReplay(replays[0], (frame) => replayChat.push(...frame.events.filter((e) => e.type === "chat")))).toEqual({ verified: true, desyncAt: undefined });
    expect(replayChat).toEqual([
      { tick: 1, type: "chat", owner: "p1", text: "secret north attack", channel: "team" },
      { tick: 3, type: "chat", owner: "p2", text: "hello everyone" },
    ]);
    expect(JSON.stringify(frames.map((f) => ({ events: f.view.events, chat: f.view.chat })))).not.toContain("secret north attack");
  });

  it("shares the cooldown between public and private messages and honors chat off", async () => {
    await start();
    const sent = room.act("p1", [{ type: "chat", channel: "team", text: "go" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await sent).results[0].ok).toBe(true);
    expect((await room.act("p1", [{ type: "chat", text: "again" }])).results[0]).toMatchObject({ ok: false, reason: "one message every 3s" });
    await vi.advanceTimersByTimeAsync(3000);
    const later = room.act("p1", [{ type: "chat", channel: "all", text: "now" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await later).results[0].ok).toBe(true);
    room.close();
    vi.useRealTimers();
    await start(false);
    expect(room.view("p1").chat).toEqual({ enabled: false, messages: [] });
    expect((await room.act("p1", [{ type: "chat", channel: "team", text: "no" }])).results[0]).toMatchObject({ ok: false, reason: "chat is off in this room" });
  });
});
