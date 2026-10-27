import type { ChatMessage, GameEvent } from "@castellan/shared";
import { NEUTRAL_OWNER } from "@castellan/shared";
import { fmtTime } from "../api";
import { agentText } from "./Agent";

type Mark = { tick: number; kind: "death" | "eliminated" | "chat" | "end"; color?: number; count: number; label: string };

/** Timeline marks, grouped in half-percent buckets so a battle is one mark, not a hundred. */
export function marksOf(events: GameEvent[], chat: ChatMessage[], total: number, colors: Record<string, number>, names: Record<string, string>): Mark[] {
  const buckets = new Map<string, Mark>();
  const add = (tick: number, kind: Mark["kind"], owner: string | undefined, what: string) => {
    const key = `${kind}:${owner ?? ""}:${Math.round((tick / Math.max(1, total - 1)) * 200)}`;
    const m = buckets.get(key);
    if (m) { m.count++; return; }
    buckets.set(key, { tick, kind, color: owner === NEUTRAL_OWNER ? undefined : colors[owner ?? ""] ?? 0, count: 1, label: `${owner ? `${agentText(owner, names[owner])} ` : ""}${what}` });
  };
  for (const e of events) {
    if (e.type === "death") add(e.tick, "death", e.owner, e.owner === NEUTRAL_OWNER ? "wall destroyed" : "lost units");
    else if (e.type === "eliminated") add(e.tick, "eliminated", e.owner, "is out");
    else if (e.type === "match_end") add(e.tick, "end", undefined, "the battle is over");
  }
  for (const m of chat) add(m.tick, "chat", m.from, "chat");
  return [...buckets.values()];
}

/** The replay's scrubber: event marks over a range of `total` ticks, the part simulated so far shaded. */
export function Timeline({ marks, total, index, loaded, tickMs, onSeek }: {
  marks: Mark[]; total: number; index: number; loaded: number; tickMs: number; onSeek: (tick: number) => void;
}) {
  const pct = (tick: number) => `${(100 * tick) / Math.max(1, total - 1)}%`;
  return (
    <div className="timeline">
      <div className="marks">
        {marks.map((m) => (
          <button key={`${m.kind}-${m.tick}-${m.color}`} className={`mark ${m.kind}${m.color === undefined ? "" : ` bg${m.color}`}`} style={{ left: pct(m.tick), ...(m.color === undefined ? { background: "var(--grey)" } : {}) }}
            title={`${fmtTime(m.tick * tickMs)} ${m.label}${m.count > 1 ? ` ×${m.count}` : ""}`} onClick={() => onSeek(m.tick)} />
        ))}
      </div>
      <input
        type="range" min={0} max={Math.max(0, total - 1)} value={index} aria-label="match time"
        onChange={(e) => onSeek(Number(e.target.value))}
        style={{ ["--loaded" as string]: `${(100 * loaded) / Math.max(1, total)}%` }}
      />
    </div>
  );
}
