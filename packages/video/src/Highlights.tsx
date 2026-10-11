import { Sequence, useVideoConfig } from "remotion";
import { Highlight } from "./scenes/Highlight";
import { Intro } from "./scenes/Intro";
import { INTRO_S, highlightSeconds, type Timeline } from "./timeline";

/** Title, then each highlight back to back (cuts: a blend would mix the dithered pixels). */
export const Highlights: React.FC<{ id: string; timeline?: Timeline }> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  if (!timeline) return null;
  let from = INTRO_S * fps;
  return (
    <>
      <Sequence name="Intro" durationInFrames={INTRO_S * fps}><Intro timeline={timeline} /></Sequence>
      {timeline.highlights.map((h, i) => {
        const length = Math.round(highlightSeconds(h) * fps);
        const seq = <Sequence key={i} name={`Highlight ${i + 1}`} from={from} durationInFrames={length}><Highlight timeline={timeline} index={i} /></Sequence>;
        from += length;
        return seq;
      })}
    </>
  );
};
