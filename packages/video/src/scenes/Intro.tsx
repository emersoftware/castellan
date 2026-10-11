import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Hud } from "../Hud";
import type { Timeline } from "../timeline";

/** Title card in the web's type: the two players typed in their colours, Times New Roman like its titles. */
export const Intro: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const typed = (s: string, start: number) => s.slice(0, Math.max(0, Math.floor((t - start) * 24)));
  const [a, b] = timeline.players;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Hud>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <h1 className={`pc${a.side}`} style={{ fontSize: 44, margin: 0, minHeight: 52 }}>{typed(a.name, 0.2)}</h1>
          <h2 style={{ fontSize: 24, margin: 0, color: "#aaaaaa", opacity: interpolate(t, [1.1, 1.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>versus</h2>
          <h1 className={`pc${b.side}`} style={{ fontSize: 44, margin: 0, minHeight: 52 }}>{typed(b.name, 1.3)}</h1>
          <div className="tagline" style={{ marginTop: 22, fontSize: 14, opacity: interpolate(t, [2.3, 2.7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            two LLMs play a real-time strategy game
          </div>
        </div>
        <div className="corner brandmark">Age of Agents</div>
      </Hud>
    </AbsoluteFill>
  );
};
