/**
 * Chat: coordination with a teammate and negotiation in free-for-all rooms,
 * with short templates written by rules.
 */
import type { ChatMessage, Order, PlayerId } from "@aoa/shared";
import type { World } from "./perception";
import { TRUCE_UNTIL_MS } from "./strategy";
import type { JournalEntry, Plan } from "./types";

const s = (n: number) => n * 10;
const ACCEPT = /\b(truce|peace|pact|allian|non-?aggression|deal|agree|accept|ok(ay)?|yes|sure|fine)\b/i;
const REFUSE = /\b(no|never|decline|refuse|reject|not interested|won'?t)\b/i;
const COORD = /\((\d{1,2})\s*,\s*(\d{1,2})\)|\b(\d{1,2})\s*,\s*(\d{1,2})\b/;

export interface DiplomacyOptions { log: (e: Omit<JournalEntry, "t">) => void }

export class Diplomacy {
  private seen = new Set<string>();
  private lastSentTick = -1000;
  private lastTopic = new Map<string, number>();
  private greeted = false;
  private proposed = new Set<PlayerId>();
  private lastPosture = "";
  private lastAttackEpisode = "";
  private pendingReplies: { to: PlayerId; text: string }[] = [];
  private answered = new Set<PlayerId>();
  sent = 0;
  received = 0;
  /** Ally requests parsed from team chat. */
  allyRequests: { kind: "help" | "attack"; at: { x: number; y: number }; tick: number; from: PlayerId }[] = [];

  constructor(private plan: Plan, private opts: DiplomacyOptions) {}

  update(w: World): Order[] {
    if (!w.view.chat?.enabled) return [];
    const out: Order[] = [];
    const send = (text: string, topic: string, extra: { to?: PlayerId; channel?: "team" | "all" } = {}, everyS = 20) => {
      if (w.tick - this.lastSentTick < s(3.2)) return false;
      const last = this.lastTopic.get(topic) ?? -10_000;
      if (w.tick - last < s(everyS)) return false;
      out.push({ type: "chat", text: text.slice(0, 200), ...(extra.to ? { to: extra.to } : extra.channel ? { channel: extra.channel } : {}) });
      this.lastSentTick = w.tick; this.lastTopic.set(topic, w.tick); this.sent++;
      this.opts.log({ tick: w.tick, type: "chat_sent", text, to: extra.to, channel: extra.channel ?? (extra.to ? "private" : "all") });
      return true;
    };
    for (const m of w.view.chat.messages) this.read(w, m);
    const ffa = !w.teams && w.enemyPlayers.length > 1;
    if (this.pendingReplies.length) {
      const r = this.pendingReplies[0];
      if (send(r.text, `reply:${r.to}`, { to: r.to }, 0)) this.pendingReplies.shift();
    }
    if (!this.greeted && w.timeMs >= 2000) {
      this.greeted = true;
      if (w.teams) send(`Ally: I hold the ${corner(w)} corner. Plan: 8 workers, a tower, then expand to my flank mines. Tell me "help (x,y)" if attacked or "attack (x,y)" to strike together.`, "greet", { channel: "team" });
      else if (ffa) send(`Proposal to all: no attacks on each other before minute 5; whoever strikes first becomes everyone's target. Reply "truce ok".`, "greet", { channel: "all" });
    }
    if (ffa && this.greeted && w.timeMs >= 5000) {
      for (const p of w.enemyPlayers) if (!this.proposed.has(p.id) && !this.plan.truces[p.id]) {
        if (send(`${p.id}: truce until minute 5? I will not attack you first. Reply "truce ok".`, `propose:${p.id}`, { to: p.id }, 60)) { this.proposed.add(p.id); break; }
      }
    }
    // Team coordination: say what matters when it changes.
    if (w.teams) {
      const posture = `${this.plan.posture}:${this.plan.postureSince}`;
      if (posture !== this.lastPosture) {
        this.lastPosture = posture;
        if (this.plan.posture === "defend") {
          const t = w.threats[0];
          if (t) send(`Under attack near (${t.x},${t.y}): ${t.units.length} ${t.owner} units. Defending. help (${t.x},${t.y}) if you can.`, "defend", { channel: "team" }, 25);
        }
        if (this.plan.posture === "attack" && this.plan.attack && this.plan.attack.episode !== this.lastAttackEpisode) {
          this.lastAttackEpisode = this.plan.attack.episode;
          send(`Attacking ${this.plan.attack.owner ?? "the enemy"} at (${this.plan.attack.target.x},${this.plan.attack.target.y}) with ${this.plan.attack.units.length} units. attack (${this.plan.attack.target.x},${this.plan.attack.target.y}) with me?`, "attack", { channel: "team" }, 30);
        }
        if (this.plan.posture === "retreat") send(`Pulling back to regroup; ${this.plan.postureReason}.`, "retreat", { channel: "team" }, 30);
      }
      if (this.plan.expansion?.status === "built" && !this.lastTopic.has(`exp:${this.plan.expansion.episode}`)) send(`Expanded at (${this.plan.expansion.site.x},${this.plan.expansion.site.y}).`, `exp:${this.plan.expansion.episode}`, { channel: "team" }, 0);
    }
    // Truces broken by aggression: say so once.
    for (const [p, t] of Object.entries(this.plan.truces)) if (t.broken && !this.lastTopic.has(`broken:${p}`)) send(`${p}: you attacked me under our truce. It is over.`, `broken:${p}`, { to: p }, 0);
    return out;
  }

  private read(w: World, m: ChatMessage) {
    const id = `${m.tick}:${m.from}:${m.text}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (m.from === w.view.you) return;
    this.received++;
    this.opts.log({ tick: w.tick, type: "chat_received", from: m.from, text: m.text, channel: m.channel ?? "all" });
    const ally = w.allyPlayers.some((p) => p.id === m.from);
    const xy = COORD.exec(m.text);
    const at = xy ? { x: Number(xy[1] ?? xy[3]), y: Number(xy[2] ?? xy[4]) } : null;
    if (ally) {
      if (at && /help|attack(ed)?|under attack|defend/i.test(m.text) && !/attack \(/i.test(m.text)) this.allyRequests.push({ kind: "help", at, tick: w.tick, from: m.from });
      else if (at && /attack/i.test(m.text)) this.allyRequests.push({ kind: "attack", at, tick: w.tick, from: m.from });
      return;
    }
    if (!w.enemyPlayers.some((p) => p.id === m.from) || w.teams) return;
    // Free-for-all negotiation.
    const direct = m.channel === "private" || /\b(you|truce|peace|pact|alliance|deal)\b/i.test(m.text);
    if (!direct) return;
    if (ACCEPT.test(m.text) && !REFUSE.test(m.text)) {
      if (!this.plan.truces[m.from] && w.timeMs < TRUCE_UNTIL_MS) {
        this.plan.truces[m.from] = { since: w.tick, proposedBy: this.proposed.has(m.from) ? "me" : "them" };
        this.opts.log({ tick: w.tick, type: "truce", with: m.from, by: this.proposed.has(m.from) ? "my proposal" : "their proposal" });
        if (!this.proposed.has(m.from)) this.pendingReplies.push({ to: m.from, text: `Truce ok until minute 5: I will not attack you first.` });
      }
      return;
    }
    if (REFUSE.test(m.text)) { this.opts.log({ tick: w.tick, type: "truce_declined", by: m.from }); return; }
    // Anything else addressed to me: answer once with my standing offer.
    if (!this.plan.truces[m.from] && !this.answered.has(m.from) && w.timeMs < TRUCE_UNTIL_MS) {
      this.answered.add(m.from);
      this.pendingReplies.push({ to: m.from, text: `I will not strike first. Truce until minute 5 if you agree: reply "truce ok".` });
    }
  }
}

function corner(w: World): string {
  const local = w.frame.toLocal({ x: 0, y: 0 });
  // The local origin is my corner; describe it from the map's point of view.
  const c = w.frame.toMap({ x: 0, y: 0 });
  const h = c.x < w.rules.map.width / 2 ? "west" : "east", v = c.y < w.rules.map.height / 2 ? "north" : "south";
  void local;
  return `${v}-${h}`;
}
