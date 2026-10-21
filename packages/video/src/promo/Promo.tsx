import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Series, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Agents } from "../../../web/src/components/Agent";
import { EventFeed } from "../../../web/src/components/Hud";
import { Hud } from "../Hud";
import { ScriptCard } from "../ScriptCard";
import type { Timeline } from "../timeline";
import { Moment, REEL_H, REEL_W, SAFE, TITLE_CSS } from "./Moment";

export type Timelines = Record<string, Timeline>;
/** "Sol 6.1 Low (knights)", "Opus 5.5 Low A" → the model: effort, seat letter and experiment notes aside. */
const short = (name: string) => name.replace(/ \(.*\)$/, "").replace(/ (Low|Medium|High)( [AB])?$/i, "");
export const names = (t: Timeline) => Object.fromEntries(t.players.map((p) => [p.id, short(p.name)]));
export const colors = (t: Timeline) => Object.fromEntries(t.players.map((p) => [p.id, p.side]));

/** Minified one-liners as players send them, laid out a statement per line for reading. */
function pretty(code: string) {
  let depth = 0, out = "";
  const src = code.trim();
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      out = `${out.trimEnd()}\n${"  ".repeat(depth)}}`;
      if (!/^\s*(else|[;),])/.test(src.slice(i + 1))) out += `\n${"  ".repeat(depth)}`;
      continue;
    }
    out += ch;
    if (ch === "{") { depth++; out += `\n${"  ".repeat(depth)}`; }
    else if (ch === ";") out += `\n${"  ".repeat(depth)}`;
  }
  return out.replace(/\n\s*\n/g, "\n").replace(/}\s*else/g, "} else").trim();
}

/** The gist of a script for the screen: callbacks of sort/filter shown as "…", and only its first `lines`. */
export function excerpt(code: string, lines: number) {
  let out = "";
  for (let i = 0; i < code.length; i++) {
    const m = /^\.(sort|filter)\(/.exec(code.slice(i));
    if (!m) { out += code[i]; continue; }
    let depth = 0, j = i + m[0].length - 1;
    for (; j < code.length; j++) { if (code[j] === "(") depth++; else if (code[j] === ")" && --depth === 0) break; }
    out += `.${m[1]}(…)`;
    i = j;
  }
  const all = pretty(out).split("\n");
  return all.length > lines ? `${all.slice(0, lines).join("\n")}\n…` : all.join("\n");
}

/**
 * The reel, cut by cut (seconds of screen time, as recorded by scripts/prepare-promo.sh). Shots on the same
 * map meet on the empty board: the units of one game dissolve, the camera rests on the middle, the next
 * game's units come in. Between maps the board dissolves too.
 */
const SHOTS = [
  { id: "pov", bars: 2 }, { id: "kite", bars: 3 }, { id: "truce", bars: 3 },
  { id: "towers", bars: 2 }, { id: "charge", bars: 4 }, { id: "end", bars: 1.5 },
] as const;
/** Cuts fall on the music's bars: "Dos voces" runs at 84 BPM, four beats a bar. */
const BAR_S = (4 * 60) / 84;
/** First frame of each shot (and the end), rounded from the bar grid so errors don't add up. */
export function cutFrames(fps: number) {
  let bars = 0;
  return [0, ...SHOTS.map((s) => Math.round((bars += s.bars) * BAR_S * fps))];
}

/** Who plays, in their colours: "A vs B", or everyone in a free-for-all. */
const Match: React.FC<{ t: Timeline }> = ({ t }) => <Agents ids={t.players.map((p) => p.id)} names={names(t)} colors={colors(t)} sep={t.players.length > 2 ? " · " : " vs "} />;

const Shot: React.FC<{ id: (typeof SHOTS)[number]["id"]; tl: Timelines; seconds: number }> = ({ id, tl, seconds }) => {
  if (id === "pov") {
    const t = tl["53bed717"];
    return <Moment clip="s1-pov.mp4" fromS={126} speed={2} seconds={seconds} match={<Match t={t} />} captions={[
      { at: 0, title: "AI models play a real\u2011time strategy game.", subtitle: `No humans. This is all ${names(t).p1} can see.` }]} />;
  }
  if (id === "kite") {
    const t = tl.eb3ebd01, s = t.scripts.find((x) => x.kind === "archer" && Math.round(x.ms / 1000) === 156)!;
    return <Moment clip="s2-kite.mp4" fromS={155} speed={2} seconds={seconds} match={<Match t={t} />} captions={[
      { at: 0, title: "They code their own units.", subtitle: `${names(t)[s.player]} tells its archers: never let a knight close in.` },
      { at: 3.2, title: "The archers kite.", subtitle: "Archers vs knights: step back, shoot, step back." }]}
      overlay={(g) => g >= s.ms / 1000 && g < 161.4 && <ScriptCard kind={s.kind} player={s.player} name={names(t)[s.player]} color={colors(t)[s.player]} ms={s.ms} code={excerpt(s.code, 10)}
        style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: "auto", bottom: SAFE.bottom + 34, maxWidth: "none" }} />} />;
  }
  if (id === "truce") {
    const t = tl["3829ed85"];
    return <Moment clip="s3-truce.mp4" fromS={466} speed={2} seconds={seconds} match={<Match t={t} />} captions={[
      { at: 0, title: "They negotiate.", subtitle: `${names(t).p1} offers a truce… to both rivals.` }]}
      overlay={(g) => <EventFeed events={t.feed.filter((e) => e.type === "chat" && e.tick / 10 <= g).slice(-2)} names={names(t)} colors={colors(t)} tickMs={t.tickMs} />} />;
  }
  if (id === "towers") {
    const t = tl.c46c237a;
    return <Moment clip="s4-towers.mp4" fromS={171} speed={16} seconds={seconds} match={<Match t={t} />} captions={[
      { at: 0, title: "Some turtle up.", subtitle: `${names(t).p3} builds a tower nest.` }]} />;
  }
  if (id === "charge") {
    const t = tl.d0e598c5, n = names(t), winner = t.players.find((p) => t.winners.includes(p.id))!;
    return <Moment clip="s5-charge.mp4" fromS={183.14} speed={2} seconds={seconds} match={<Match t={t} />} captions={[
      { at: 0, title: "Others charge.", subtitle: `${n[winner.id]} breaks through and takes the king.` }]} />;
  }
  return <EndCard />;
};

/** Closing card: what this is and where to watch, in the web's titles (no game name yet). */
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const a = (from: number) => interpolate(t, [from, from + 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Hud width={REEL_W} height={REEL_H} css={TITLE_CSS}>
        <div className="reel-title" style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: SAFE.top, bottom: SAFE.bottom, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18 }}>
          <h1 style={{ opacity: a(0.1) }}>{"AI models play a real\u2011time strategy game."}</h1>
          <h3 style={{ margin: 0, opacity: a(0.5) }}>Watch them play, live.</h3>
          <div className="tagline" style={{ fontSize: 26, marginTop: 24, color: "#ffff55", opacity: a(0.9) }}>rts.emersoftware.cl</div>
        </div>
      </Hud>
    </AbsoluteFill>
  );
};

const MUSIC_GAIN = 0.7;

export const Promo: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  const { fps } = useVideoConfig();
  if (!timelines) return null;
  const cuts = cutFrames(fps), total = cuts.at(-1)! / fps;
  return (
    <>
    {/* Bass, pad and drums of "Dos voces" (estudio 03), fading out on the closing card. */}
    <Audio src={staticFile("music/acompanamiento.flac")} volume={(f) => MUSIC_GAIN * interpolate(f / fps, [0, 0.5, total - 2.5, total], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    <Series>
      {SHOTS.map((s, i) => (
        <Series.Sequence key={s.id} name={s.id} durationInFrames={cuts[i + 1] - cuts[i]}><Shot id={s.id} tl={timelines} seconds={(cuts[i + 1] - cuts[i]) / fps} /></Series.Sequence>
      ))}
    </Series>
    </>
  );
};
