import { useEffect, useRef } from "react";
import { RAMPS, PLAYER_RAMPS } from "../render/palette";
import { ditherRamp } from "../render/cpuDither";
import { isCharacter } from "../render/characterContrast";

/** Units show their front-right facing (sheet view 1). */
const FILES: Record<string, string> = { nexus: "castle", turret: "tower", deposit: "gold", agent: "king_1", king: "king_1", worker: "worker_1", knight: "knight_1", ranger: "ranger_1" };

/** A unit's sprite, ramp-dithered like in the game. */
export function Portrait({ kind, team = 0, height = 120 }: { kind: string; team?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const w = Math.round((height * img.width) / img.height);
      const ramp = kind === "deposit" ? RAMPS.gold : kind === "rock" ? RAMPS.neutral : PLAYER_RAMPS[team];
      const out = ditherRamp(img, w, height, ramp, 1.1, isCharacter(kind));
      const cv = ref.current;
      if (!cv) return;
      cv.width = w;
      cv.height = height;
      cv.getContext("2d")!.drawImage(out, 0, 0);
    };
    img.src = `/sprites/${FILES[kind] ?? kind}.${kind === "door" ? "svg" : "png"}`;
  }, [kind, team, height]);
  return <canvas ref={ref} className="portrait" />;
}
