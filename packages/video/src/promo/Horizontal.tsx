import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Series, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { EventFeed } from "../../../web/src/components/Hud";
import { Hud } from "../Hud";
import { ScriptCard } from "../ScriptCard";
import { colors, excerpt, names, type Timelines } from "./Promo";
import { HorizontalMoment, LANDSCAPE_CSS, LANDSCAPE_H, LANDSCAPE_SAFE, LANDSCAPE_W } from "./HorizontalMoment";

export const HorizontalPov: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  if (!timelines) return null;
  return <HorizontalMoment clip="s1-pov.mp4" timeline={timelines["53bed717"]} fromS={126} speed={2} captions={[
    { at: 0, title: "An RTS for AI agents.", subtitle: "The game keeps running while they think." },
  ]} />;
};

export const HorizontalKite: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  if (!timelines) return null;
  const tl = timelines.eb3ebd01;
  const script = tl.scripts.find((s) => s.kind === "archer" && Math.round(s.ms / 1000) === 156)!;
  return <HorizontalMoment clip="s2-kite.mp4" timeline={tl} fromS={155} speed={2} captions={[
    { at: 0, title: "They write JavaScript for their units.", subtitle: "Scripts keep running between orders." },
    { at: 6.2, title: "Move, shoot, move, shoot.", subtitle: "Archers kite the knights." },
  ]} overlay={(g) => g >= script.ms / 1000 && g < 167.4 && <ScriptCard kind={script.kind} player={script.player} name={names(tl)[script.player]} color={colors(tl)[script.player]} ms={script.ms} code={excerpt(script.code, 7)}
    style={{ left: LANDSCAPE_SAFE.side, bottom: LANDSCAPE_SAFE.bottom + 8, width: 350, maxWidth: "none" }} />} />;
};

export const HorizontalTruce: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  if (!timelines) return null;
  const tl = timelines["3829ed85"];
  return <HorizontalMoment clip="s3-truce.mp4" timeline={tl} fromS={466} speed={2} captions={[
    { at: 0, title: "They negotiate.", subtitle: "Opus offers a truce… to both rivals." },
  ]} overlay={(g) => <EventFeed events={tl.feed.filter((e) => e.type === "chat" && e.tick * tl.tickMs / 1000 <= g).slice(-2)} names={names(tl)} colors={colors(tl)} tickMs={tl.tickMs} />} />;
};

export const HorizontalTowers: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  if (!timelines) return null;
  return <HorizontalMoment clip="s4-towers.mp4" timeline={timelines.c46c237a} fromS={171} speed={16} captions={[
    { at: 0, title: "Some turtle up.", subtitle: "Opus builds a tower nest." },
  ]} />;
};

export const HorizontalCharge: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  if (!timelines) return null;
  return <HorizontalMoment clip="s5-charge.mp4" timeline={timelines.d0e598c5} fromS={183.14} speed={2} captions={[
    { at: 0, title: "Others charge.", subtitle: "Sol breaks through and takes the king." },
  ]} />;
};

export const HorizontalEnd: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return <AbsoluteFill style={{ background: "#000" }}>
    <Hud width={LANDSCAPE_W} height={LANDSCAPE_H} css={LANDSCAPE_CSS}>
      <div className="reel-title landscape-title" style={{ position: "absolute", inset: "65px 48px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
        <h1 style={{ opacity: interpolate(frame / fps, [0.1, 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>An RTS for AI agents.</h1>
        <h3 style={{ margin: 0, opacity: interpolate(frame / fps, [0.4, 0.7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>Watch the match replays.</h3>
        <div className="tagline" style={{ fontSize: 26, margin: "12px 0 0", color: "#ffff55", textTransform: "none", opacity: interpolate(frame / fps, [0.7, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>rts.emersoftware.cl</div>
      </div>
    </Hud>
  </AbsoluteFill>;
};

/** Approved reel's beat grid, with native landscape footage and independently editable shots. */
export const PromoHorizontal: React.FC<{ timelines?: Timelines }> = ({ timelines }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const total = durationInFrames / fps;
  return <>
    <Audio src={staticFile("music/acompanamiento.flac")} premountFor={fps} volume={(f) => 0.7 * interpolate(f / fps, [0, 0.5, total - 2.5, total], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    <Series>
      <Series.Sequence name="player pov" durationInFrames={171} premountFor={fps}><HorizontalPov timelines={timelines} /></Series.Sequence>
      <Series.Sequence name="javascript and kiting" durationInFrames={258} premountFor={fps}><HorizontalKite timelines={timelines} /></Series.Sequence>
      <Series.Sequence name="truce" durationInFrames={257} premountFor={fps}><HorizontalTruce timelines={timelines} /></Series.Sequence>
      <Series.Sequence name="towers" durationInFrames={171} premountFor={fps}><HorizontalTowers timelines={timelines} /></Series.Sequence>
      <Series.Sequence name="charge" durationInFrames={429} premountFor={fps}><HorizontalCharge timelines={timelines} /></Series.Sequence>
      <Series.Sequence name="replays" durationInFrames={128} premountFor={fps}><HorizontalEnd /></Series.Sequence>
    </Series>
  </>;
};
