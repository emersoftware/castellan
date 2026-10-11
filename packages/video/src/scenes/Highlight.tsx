import { Video } from "@remotion/media";
import type { SpectatorView } from "@aoa/shared";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Agent } from "../../../web/src/components/Agent";
import { EventFeed, OutcomeBanner, PlayerList, notableEvents } from "../../../web/src/components/Hud";
import { Hud } from "../Hud";
import { ScriptCard } from "../ScriptCard";
import { SPEED, clock, type Timeline } from "../timeline";

const SCRIPT_S = 4.5;

/**
 * One stretch of the game: the footage (camera on the fighting) under the web's own HUD — scoreboard,
 * event feed (chat included), the script a player just loaded as the unit panel shows it, a caption in
 * the titles' serif, and the outcome banner once the king falls.
 */
export const Highlight: React.FC<{ timeline: Timeline; index: number }> = ({ timeline, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const h = timeline.highlights[index];
  const t = frame / fps, ms = Math.min(timeline.endMs, h.fromMs + t * 1000 * SPEED);
  const names = Object.fromEntries(timeline.players.map((p) => [p.id, p.name]));
  const colors = Object.fromEntries(timeline.players.map((p) => [p.id, p.side]));
  const stats = timeline.stats[Math.min(timeline.stats.length - 1, Math.floor(ms / 1000))];
  const over = timeline.kingDeathMs !== null && ms >= timeline.kingDeathMs;
  const view = { timeMs: ms, matchMs: timeline.matchMs, players: stats.players, outcome: over ? timeline.outcome : undefined } as unknown as SpectatorView;
  // The last few notable events of the past 20 s of game.
  const events = notableEvents(timeline.feed.filter((e) => e.tick * timeline.tickMs <= ms && ms - e.tick * timeline.tickMs < 20_000)).slice(-4);
  const script = timeline.scripts.filter((s) => s.ms <= ms && ms - s.ms <= SCRIPT_S * 1000 * SPEED).at(-1);
  const fallen = Object.entries(h.lost).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  const caption = h.final ? "The final battle" : fallen ? `${names[fallen[0]]} loses ${fallen[1]} ${fallen[1] === 1 ? "unit" : "units"}` : "First contact";
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Video src={staticFile(`${timeline.id}.mp4`)} trimBefore={Math.round((h.fromMs / 1000 / SPEED) * fps)} muted />
      <Hud>
        {!over && <PlayerList view={view} names={names} colors={colors} />}
        {!script && !over && <EventFeed events={events} names={names} colors={colors} tickMs={timeline.tickMs} />}
        {!over && (
          <div className="corner right" style={{ bottom: 18, textAlign: "right" }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>{caption}</h2>
            <div style={{ color: "#aaaaaa", fontSize: 12, marginTop: 2 }}>{clock(h.fromMs)} · 2× speed</div>
          </div>
        )}
        {script && !over && <ScriptCard kind={script.kind} player={script.player} name={names[script.player]} color={colors[script.player]} ms={script.ms} code={script.code} />}
        {over && (
          <OutcomeBanner view={view} names={names} colors={colors}>
            {timeline.players.map((p) => {
              const scripts = timeline.scripts.filter((s) => s.player === p.id).length;
              return (
                <div key={p.id} style={{ fontSize: 13, marginTop: 4 }}>
                  <Agent id={p.id} name={p.name} color={p.side} />: {p.lost} units lost · {p.orders} orders · {scripts ? `${scripts} scripts` : "no scripts"}
                </div>
              );
            })}
          </OutcomeBanner>
        )}
      </Hud>
    </AbsoluteFill>
  );
};
