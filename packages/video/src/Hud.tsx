/**
 * The web app's interface over the footage: its stylesheet, its dither filter and its components, laid out
 * at game pixels and scaled 2× like the map, so text and dots match the board (scripts/dither.mjs then
 * puts the whole frame through the game's own palette dither).
 */
import "../../web/src/styles.css";
import { AbsoluteFill } from "remotion";
import { DitherDefs } from "../../web/src/components/DitherDefs";
import { GAME_H, GAME_W, PIXEL } from "./timeline";

export const Hud: React.FC<{ children: React.ReactNode; width?: number; height?: number; css?: string }> = ({ children, width = GAME_W, height = GAME_H, css = "" }) => (
  <AbsoluteFill>
    <DitherDefs />
    {/* The feed sits bottom-left here: the scoreboard takes the top, and the map stays clear. */}
    <style>{`.video-hud .feed { top: auto; bottom: 14px; width: 280px; } .video-hud .banner { top: 45%; width: 600px; box-sizing: border-box; padding: 22px 30px; } ${css}`}</style>
    <div className="game video-hud" style={{ position: "absolute", left: 0, top: 0, width, height, scale: String(PIXEL), transformOrigin: "0 0", background: "transparent" }}>
      {children}
    </div>
  </AbsoluteFill>
);
