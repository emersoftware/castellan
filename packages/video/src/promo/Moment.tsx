import { Audio, Video } from "@remotion/media";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Hud } from "../Hud";

/** Vertical reel: 540×960 game pixels, scaled 2× to 1080×1920. */
export const REEL_W = 540, REEL_H = 960;
/**
 * Where text may go, in game pixels: clear of the sides and of what feeds lay over the video (the app's bar
 * on top; caption, handle and buttons at the bottom and right).
 */
export const SAFE = { top: 110, bottom: 200, side: 40 };
/** Units come and go in the footage over this long; titles follow them. */
const FADE_S = 1;

/** One game pixel of black around letters, so they read over the board. */
const OUTLINE = "1px 0 #000, -1px 0 #000, 0 1px #000, 0 -1px #000";
/** 4×4 Bayer cells lit white at a mid tone (10 of 16): titles are white letters with the black showing through. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const TONE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" shape-rendering="crispEdges"><rect width="4" height="4" fill="#000"/>${BAYER.map((b, i) => (b < 10 ? `<rect x="${i % 4}" y="${Math.floor(i / 4)}" width="1" height="1" fill="#fff"/>` : "")).join("")}</svg>`)}")`;
/** Serif titles of the reel (also the closing card). */
export const TITLE_CSS = `
  .reel-title h1, .reel-title h3 { text-wrap: balance; }
  .reel-title h1 { font-size: 42px; line-height: 1.08; margin: 0; font-weight: 400; color: transparent;
    background: ${TONE}; background-size: 4px 4px; background-clip: text; -webkit-background-clip: text; filter: drop-shadow(1px 0 #000) drop-shadow(-1px 0 #000) drop-shadow(0 1px #000) drop-shadow(0 -1px #000); }
  .reel-title h3 { font-size: 22px; line-height: 1.25; margin: 12px 0 0; color: #aaaaaa; text-shadow: ${OUTLINE}; }
`;

/** A title from `at` (seconds into the shot) until the next one. */
export interface Caption { at: number; title: string; subtitle?: string }

export interface MomentProps {
  /** Clip in public/promo, recorded from `fromS` (game seconds) at `speed`; it runs `seconds`. */
  clip: string; fromS: number; speed: number; seconds: number;
  captions: Caption[];
  /** Who plays, over the title (the web's coloured agent names). */
  match?: React.ReactNode;
  /** Extra HUD for the current game second. */
  overlay?: (gameS: number) => React.ReactNode;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * One moment of a game: the footage (its units dissolve in and out in the recording itself), serif titles in
 * the safe area at the top, and the playback speed under them the whole time.
 */
export const Moment: React.FC<MomentProps> = ({ clip, fromS, speed, seconds, captions, match, overlay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps, gameS = fromS + t * speed;
  const i = captions.findLastIndex((c) => c.at <= t), c = captions[Math.max(0, i)];
  const next = captions[i + 1]?.at ?? seconds;
  // Titles dissolve (the dither turns opacity into the screen door) with the units and between each other.
  const shown = Math.min(interpolate(t, [c.at, c.at + 0.3], [0, 1], clamp), interpolate(t, [next - 0.3, next], [1, 0], clamp));
  const hud = Math.min(interpolate(t, [0, FADE_S], [0, 1], clamp), interpolate(t, [seconds - FADE_S, seconds], [1, 0], clamp));
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Video src={staticFile(`promo/${clip}`)} muted />
      {/* The board's sounds and wind, mixed by scripts/sfx.mjs from what the recording played. */}
      <Audio src={staticFile(`promo/${clip.replace(/\.mp4$/, ".sfx.wav")}`)} />
      <Hud width={REEL_W} height={REEL_H} css={`
        .video-hud .unit-panel { font-size: 15px; }
        .video-hud .unit-script pre { font-size: 13px; max-height: none; overflow: visible; }
        .video-hud .feed { font-size: 19px; }
        /* The web fades each line's backing to the right; dithered over the board it vanishes past a third. */
        .video-hud .feed .line { background: rgba(0,0,0,0.85); }
        .video-hud .feed { left: ${SAFE.side}px; right: ${SAFE.side}px; width: auto; bottom: ${SAFE.bottom + 34}px; }
        ${TITLE_CSS}
        .reel-match { position: absolute; left: ${SAFE.side}px; right: ${SAFE.side}px; top: ${SAFE.top}px; text-align: center; font-family: var(--sans); font-size: 17px; color: #aaaaaa; letter-spacing: 0.04em; text-shadow: ${OUTLINE}; }
        .reel-match .pid { display: none; }
        .reel-speed { position: absolute; right: ${SAFE.side}px; bottom: ${SAFE.bottom}px; font-family: var(--sans); font-size: 18px; color: #aaaaaa; letter-spacing: 0.06em; text-shadow: ${OUTLINE}; }
      `}>
        {match && <div className="reel-match" style={{ opacity: hud }}>{match}</div>}
        <div className="reel-title" style={{ position: "absolute", left: SAFE.side, right: SAFE.side, top: SAFE.top + (match ? 32 : 0), textAlign: "center", opacity: shown }}>
          <h1>{c.title}</h1>
          {c.subtitle && <h3>{c.subtitle}</h3>}
        </div>
        <div className="reel-speed">{speed}×</div>
        <div style={{ opacity: hud }}>{overlay?.(gameS)}</div>
      </Hud>
    </AbsoluteFill>
  );
};
