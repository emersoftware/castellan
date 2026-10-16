import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, staticFile } from "remotion";
import { Agents } from "../../../web/src/components/Agent";
import { Hud } from "../Hud";
import type { Timeline } from "../timeline";
import { colors, names } from "./Promo";
import { TITLE_CSS, type Caption } from "./Moment";

// Native 16:9 recording at game pixels; the HUD and board both scale by 2.
export const LANDSCAPE_W = 960, LANDSCAPE_H = 540;
export const LANDSCAPE_SAFE = { side: 48, top: 36, bottom: 40 };
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
// Mostly white (14/16 cells), with a visible Bayer grid at the board's pixel
// size. Bake the lettering pattern into the preview as well as the export.
const WHITE_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const WHITE_TONE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" shape-rendering="crispEdges"><rect width="4" height="4" fill="#000"/>${WHITE_BAYER.map((v, i) => v < 14 ? `<rect x="${i % 4}" y="${Math.floor(i / 4)}" width="1" height="1" fill="#fff"/>` : "").join("")}</svg>`)}")`;
export const LANDSCAPE_CSS = `${TITLE_CSS}
  .landscape-match, .landscape-speed { filter: url(#aoa-dither); }
  /* White Times lettering, with the hero's thin black contour and game-sized dots. */
  .landscape-title h1, .landscape-title h3 { color: transparent; background: ${WHITE_TONE}; background-size: 4px 4px; background-clip: text; -webkit-background-clip: text; text-shadow: none;
    filter: drop-shadow(1px 0 #000) drop-shadow(-1px 0 #000) drop-shadow(0 1px #000) drop-shadow(0 -1px #000); }
  .landscape-title h1 { font-size: 40px; }
  .landscape-title h3 { font-size: 22px; margin-top: 7px; }
  .landscape-match, .landscape-speed { font-family: var(--sans); color: #aaaaaa; font-size: 16px; letter-spacing: 0.04em; text-shadow: 1px 0 #000, -1px 0 #000, 0 1px #000, 0 -1px #000; }
  .landscape-match .pid { display: none; }
  .video-hud .unit-panel { max-height: none; overflow: visible; background: rgba(0,0,0,0.85); font-size: 14px; }
  .video-hud .unit-script pre { font-size: 13px; max-height: none; overflow: visible; }
  .video-hud .feed { left: 48px; right: auto; bottom: 48px; width: 550px; font-size: 18px; }
  .video-hud .feed .line { background: rgba(0,0,0,0.85); }
`;

type Props = {
  clip: string;
  timeline: Timeline;
  fromS: number;
  speed: number;
  captions: Caption[];
  overlay?: (gameS: number) => React.ReactNode;
};

/** Same Bayer lettering, game HUD, and quiet speed indicator as the approved reel. */
export const HorizontalMoment: React.FC<Props> = ({ clip, timeline, fromS, speed, captions, overlay }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps, seconds = durationInFrames / fps;
  const i = Math.max(0, captions.findLastIndex((c) => c.at <= t));
  const c = captions[i], next = captions[i + 1]?.at ?? seconds;
  const shown = Math.min(interpolate(t, [c.at, c.at + 0.3], [0, 1], clamp), interpolate(t, [next - 0.3, next], [1, 0], clamp));
  const hud = Math.min(interpolate(t, [0, 1], [0, 1], clamp), interpolate(t, [seconds - 1, seconds], [1, 0], clamp));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Video src={staticFile(`horizontal/${clip}`)} muted premountFor={fps} />
      <Audio src={staticFile(`horizontal/${clip.replace(/\.mp4$/, ".sfx.wav")}`)} premountFor={fps} />
      <Hud width={LANDSCAPE_W} height={LANDSCAPE_H} css={LANDSCAPE_CSS}>
        <div className="landscape-match" style={{ position: "absolute", left: LANDSCAPE_SAFE.side, right: LANDSCAPE_SAFE.side, top: LANDSCAPE_SAFE.top, textAlign: "center", opacity: hud }}>
          <Agents ids={timeline.players.map((p) => p.id)} names={names(timeline)} colors={colors(timeline)} sep={timeline.players.length > 2 ? " · " : " vs "} />
        </div>
        <div className="reel-title landscape-title" style={{ position: "absolute", left: LANDSCAPE_SAFE.side, right: LANDSCAPE_SAFE.side, top: LANDSCAPE_SAFE.top + 26, textAlign: "center", opacity: shown }}>
          <h1>{c.title}</h1>
          {c.subtitle && <h3>{c.subtitle}</h3>}
        </div>
        <div className="landscape-speed" style={{ position: "absolute", right: LANDSCAPE_SAFE.side, bottom: LANDSCAPE_SAFE.bottom }}>{speed}×</div>
        <div style={{ opacity: hud }}>{overlay?.(fromS + t * speed)}</div>
      </Hud>
    </AbsoluteFill>
  );
};
