/**
 * The player API: everything a player's token authorizes. Each authorized game call is recorded in its room's
 * experiment and answered in JSON or, with `?format=text`, in the compact text form.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { transform } from "esbuild";
import type { ScriptResult } from "@castellan/sandbox";
import { API_LIMITS, HISTORY_SECTIONS, chatLine, declaredAgent, isChatChannel, playerGuide, routes, viewToText,
  type HistorySection, type Order, type OrderResult, type PlayerId, type Ruleset } from "@castellan/shared";
import { agentConfiguration, type PlayerCall } from "../experiment";
import type { Room } from "../room";
import type { Rooms } from "../rooms";
import type { SeriesStore } from "../series";
import { runOnceIsolated, validateScriptIsolated } from "../script-isolation";
import { int, wantsText } from "./query";

/** A call a player token authorized: its room, the player and the call its room's experiment records. */
interface Seat { room: Room; player: PlayerId; call: PlayerCall }

declare module "fastify" {
  interface FastifyRequest {
    seat: Seat | null;
  }
}

export interface PlayerRoutesOptions {
  rooms: Rooms;
  series: SeriesStore;
  /** The server's rules and clock, for a guide asked without a token. */
  ruleset: Ruleset;
  tickRate?: number;
}

/** The unit and production orders a one-off `run` may give; scripts, chat and the rest go through their own routes. */
const RUN_ORDERS = new Set<Order["type"]>(["move", "attack", "gather", "build", "train", "upgrade", "stop", "heal", "hack", "convert"]);

export const playerRoutes: FastifyPluginAsync<PlayerRoutesOptions> = async (app, { rooms, series, ruleset, tickRate }) => {
  const bearer = (req: FastifyRequest) => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : undefined;
  };

  app.decorateRequest("seat", null);
  // Every answered call closes the player's timing window (see ExperimentRecorder.call).
  app.addHook("onResponse", async (req, reply) => req.seat?.call.answer(reply.statusCode));

  /** The seat a request's token opens, as a game call of its player; answers 401, or 400 for a malformed declaration. */
  const authorize = (req: FastifyRequest, reply: FastifyReply): Seat | null => {
    const seat = rooms.seat(bearer(req) ?? (req.query as Record<string, string>)?.token ?? "");
    if (!seat) {
      reply.code(401).send({ error: "missing or invalid token (Authorization: Bearer <token>)" });
      return null;
    }
    try {
      const declared = declaredAgent(req.headers);
      if (declared !== undefined) seat.room.experiment.declare(seat.player, agentConfiguration(declared));
    } catch (error) { reply.code(400).send({ error: (error as Error).message }); return null; }
    seat.room.touch(seat.player);
    req.seat = { ...seat, call: seat.room.experiment.call(seat.player, `${req.method} ${req.routeOptions.url}`) };
    return req.seat;
  };

  // ───────── harness metadata and supervision: neither connects a player nor consumes its observation cursor ─────────

  /** Records what a harness reports about its agent while the match lasts. */
  const metadata = (record: (seat: { room: Room; player: PlayerId }, body: unknown) => void) => async (req: FastifyRequest, reply: FastifyReply) => {
    const seat = rooms.seat(bearer(req) ?? "");
    if (!seat) return reply.code(401).send({ error: "a valid player token is required" });
    if (seat.room.state === "finished") return reply.code(409).send({ error: "match over" });
    try { record(seat, req.body); }
    catch (error) { return reply.code(400).send({ error: (error as Error).message }); }
    return { ok: true };
  };
  app.post(routes.agentConfig, metadata(({ room, player }, body) => room.experiment.configure(player, agentConfiguration(body))));
  app.post(routes.agentStatus, metadata(({ room, player }, body) => room.experiment.activity(player, body)));

  app.get(routes.status, async (req, reply) => {
    const seat = rooms.seat(bearer(req) ?? "");
    if (!seat) return reply.code(401).send({ error: "missing or invalid token (Authorization: Bearer <token>)" });
    return seat.room.playerStatus(seat.player);
  });

  app.get(routes.currentSeries, async (req, reply) => series.current(bearer(req) ?? "") ?? reply.code(401).send({ error: "a valid series participant token is required" }));

  // With a token: the guide to that player's room (its map). Without: the defaults.
  app.get(routes.guide, async (req) => {
    const room = rooms.seat(bearer(req) ?? "")?.room;
    const r = room?.ruleset ?? ruleset;
    const guide = playerGuide(r, { chat: room?.chat ?? true, teams: room?.teams, playerCount: room?.players.length, tickRate: room?.tickRate ?? tickRate ?? 10 }, room?.seriesProgress?.());
    if (wantsText(req)) return guide;
    return { ruleset: r, guide };
  });

  // ───────────────────────── game calls ─────────────────────────

  app.get(routes.state, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const q = req.query as Record<string, string>;
    const v = seat.room.view(seat.player, q.since === undefined ? undefined : int(q.since, 0));
    return wantsText(req) ? viewToText(v) : v;
  });

  app.get(routes.history, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const q = req.query as Record<string, string>;
    const section: HistorySection | undefined = q.section === undefined ? "summary" : HISTORY_SECTIONS.find((s) => s === q.section);
    if (!section) return reply.code(400).send({ error: "section must be summary, events, chat, scripts or orders" });
    const game = q.game === undefined ? undefined : Number(q.game);
    const offset = q.offset === undefined ? 0 : Number(q.offset);
    const limit = q.limit === undefined ? API_LIMITS.historyPage : Number(q.limit);
    if ((game !== undefined && (!Number.isInteger(game) || game < 1 || game > 3)) || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > API_LIMITS.historyPageMax) return reply.code(400).send({ error: `game must be 1..3, offset >= 0, limit 1..${API_LIMITS.historyPageMax} (integers)` });
    try {
      const history = await series.history(seat.room.id, seat.player, game, section, offset, limit);
      return wantsText(req) ? JSON.stringify(history, null, 2) : history;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status) return reply.code(status).send({ error: (error as Error).message });
      throw error;
    }
  });

  app.post(routes.act, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const body = req.body as { orders?: unknown; since?: number } | undefined;
    if (!Array.isArray(body?.orders)) return reply.code(400).send({ error: `body must be {"orders":[...]} (max ${API_LIMITS.orders})` });
    // Orders past the cap are answered too, so a client never mistakes a dropped order for an applied one.
    const orders = (body!.orders as Order[]).slice(0, API_LIMITS.orders);
    const scripts = await Promise.all(orders.map((o) => (o?.type === "script" ? prepareScript(o.code, "js", ruleset) : null)));
    const prepared = orders.map((o, i) => (scripts[i]?.ok ? { ...o, code: scripts[i]!.code } : o)) as Order[];
    const { results: applied } = await seat.room.act(seat.player, prepared);
    const results: OrderResult[] = [...applied, ...body!.orders.slice(API_LIMITS.orders).map(() => ({ ok: false as const, reason: `over ${API_LIMITS.orders} orders per call` }))];
    seat.call.failed = results.some((r) => !r.ok);
    const view = seat.room.view(seat.player, body?.since);
    const mineral = { spent: results.reduce((n, r) => n + (r.mineral?.spent ?? 0), 0), remaining: view.players.find((p) => p.id === seat.player)!.mineral };
    const line = results.map((r, i) => `order ${i}: ${r.ok ? "ok" + ("id" in r && r.id ? " " + r.id : "") : "FAILED " + r.reason}${r.mineral ? ` · mineral spent ${r.mineral.spent}, remaining ${r.mineral.remaining}${r.mineral.pending !== undefined ? ` · build cost ${r.mineral.pending} pending until completion` : ""}` : ""}`).join("\n");
    return wantsText(req) ? `${line}\nmineral spent by these orders: ${mineral.spent} · remaining now: ${mineral.remaining}\n\n${viewToText(view)}` : { results, mineral, view };
  });

  // A one-shot player script: reads the full JSON view and rules, returns orders applied like /act.
  app.post(routes.run, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const body = req.body as { code?: unknown; lang?: unknown } | undefined;
    if (typeof body?.code !== "string" || !body.code.trim()) return reply.code(400).send({ error: 'body must be {"code":"...","lang"?:"js"|"ts"}' });
    let code = body.code;
    if (body.lang === "ts") {
      const stripped = await stripTypes(code);
      if (!stripped.ok) return reply.code(400).send({ error: stripped.error });
      code = stripped.code;
    }
    const view = seat.room.view(seat.player);
    const out = await runOnceIsolated(code, { view, game: seat.room.ruleset ?? ruleset });
    if (out.operationalFailure && out.error) seat.room.experiment.operationalFailure(seat.player, out.error);
    const orders = out.orders.filter((o): o is Order => !!o && typeof o === "object" && RUN_ORDERS.has((o as Order).type));
    const rejected = out.orders.length - orders.length;
    const { results, tick } = orders.length ? await seat.room.act(seat.player, orders) : { results: [], tick: seat.room.tick };
    const result = { ...(out.error ? { error: out.error } : {}), tick, orders, results, ...(rejected ? { rejected } : {}), value: out.value, logs: out.logs };
    seat.call.failed = !!out.error || rejected > 0 || results.some((r) => !r.ok);
    if (!wantsText(req)) return result;
    return [
      out.error ? `run FAILED: ${out.error} (no orders applied)` : `run ok · ${orders.length} order(s)${rejected ? ` · ${rejected} ignored (run accepts ${[...RUN_ORDERS].join(", ")})` : ""}`,
      ...results.map((r, i) => `order ${i} ${JSON.stringify(orders[i])}: ${r.ok ? "ok" + ("id" in r && r.id ? " " + r.id : "") : "FAILED " + r.reason}`),
      ...(out.value !== null ? [`returned: ${JSON.stringify(out.value)}`] : []),
      ...(out.logs.length ? ["logs:", ...out.logs.map((l) => `  ${l}`)] : []),
    ].join("\n");
  });

  app.get(routes.chat, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const log = seat.room.conversation(seat.player);
    if (!wantsText(req)) return { chat: seat.room.chat, messages: log };
    if (!seat.room.chat) return "chat is off in this room";
    return log.length ? log.map((m) => chatLine(m, seat.player)).join("\n") : "no messages yet";
  });

  app.post(routes.chat, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const { text, channel, to } = (req.body as { text?: unknown; channel?: unknown; to?: unknown } | undefined) ?? {};
    if (typeof text !== "string") return reply.code(400).send({ error: 'body must be {"text":"..."} (max 200 chars)' });
    if (channel !== undefined && !isChatChannel(channel)) return reply.code(400).send({ error: 'channel must be "all", "team" or "private"' });
    if (to !== undefined && (typeof to !== "string" || !to.length || to.length >= 64)) return reply.code(400).send({ error: "to must be a player id" });
    const { results } = await seat.room.act(seat.player, [{ type: "chat", text, channel, to }]);
    const r = results[0];
    return answer(req, reply, seat, r.ok ? "message sent" : `FAILED ${r.reason}`, { ok: r.ok, error: r.ok ? undefined : r.reason }, r.ok ? 200 : 400);
  });

  app.get(`${routes.scripts}/:kind`, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const kind = (req.params as { kind: string }).kind, scripts = seat.room.scripts(seat.player);
    return (Object.hasOwn(scripts, kind) && scripts[kind]) || reply.code(404).send({ error: "that kind is not scriptable" });
  });

  app.put(`${routes.scripts}/:kind`, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const kind = (req.params as { kind: string }).kind;
    const body = (req.body ?? {}) as { code?: unknown; lang?: string };
    if (body.code !== null && typeof body.code !== "string") return reply.code(400).send({ error: 'body must be {"code":"...","lang":"js"|"ts"} (code null = default)' });
    const prepared = body.code === null ? { ok: true as const, code: null } : await prepareScript(body.code, body.lang === "ts" ? "ts" : "js", ruleset);
    if (!prepared.ok) return reply.code(400).send({ ok: false, error: prepared.error });
    const { results, tick } = await seat.room.act(seat.player, [{ type: "script", kind, code: prepared.code }]);
    const r = results[0];
    const line = r.ok ? `${kind} script ${prepared.code === null ? "reset to default" : "uploaded"}, applied at tick ${tick}` : `FAILED ${r.reason}`;
    return answer(req, reply, seat, line, { ok: r.ok, error: r.ok ? undefined : r.reason, appliedAt: r.ok ? tick : undefined }, r.ok ? 200 : seat.room.state === "running" ? 400 : 409);
  });

  app.get(routes.wait, async (req, reply) => {
    const seat = authorize(req, reply);
    if (!seat) return;
    const q = req.query as Record<string, string>;
    const since = int(q.since, seat.room.cursor(seat.player));
    const maxMs = Math.min(30, Math.max(0, int(q.max, 5))) * 1000;
    const started = Date.now();
    await seat.room.wait(seat.player, since, maxMs, q.until ? q.until.split(",") : null);
    seat.call.waitedMs = Date.now() - started;
    const v = seat.room.view(seat.player, since);
    return wantsText(req) ? viewToText(v) : v;
  });

  /** Actions return their result and the current player view. */
  function answer(req: FastifyRequest, reply: FastifyReply, seat: Seat, line: string, body: object, code: number) {
    const view = seat.room.view(seat.player);
    reply.code(code);
    return wantsText(req) ? `${line}\n\n${viewToText(view)}` : { ...body, view };
  }
};

/** Strips TypeScript types (never type-checks) and compile-checks the result. */
async function prepareScript(code: string | null, lang: "js" | "ts", ruleset: Ruleset): Promise<ScriptResult<{ code: string | null }>> {
  if (code === null) return { ok: true, code: null };
  const js = lang === "ts" ? await stripTypes(code) : { ok: true as const, code };
  if (!js.ok) return js;
  const check = await validateScriptIsolated(js.code, ruleset.script);
  return check.ok ? js : { ok: false, error: check.error };
}

/**
 * Removes TypeScript syntax from a function body without type-checking it. Unit
 * scripts and /run code are both bodies, so they may `return` at the top level;
 * a module transform would turn that into CommonJS the sandbox cannot run.
 */
async function stripTypes(body: string): Promise<ScriptResult<{ code: string }>> {
  try {
    const out = await transform(`(function () {\n${body}\n});`, { loader: "ts", format: "esm" });
    const m = /^\(function\s*\(\)\s*\{\n?([\s\S]*)\n?\}\);?\s*$/.exec(out.code.trim());
    return m ? { ok: true, code: m[1] } : { ok: false, error: "could not strip TypeScript types" };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 300) };
  }
}
