import { useEffect, useRef, useState } from "react";
import type { Ruleset, SpectatorView } from "@aoa/shared";
import { GameRenderer, type HoverInfo, type SoundSink } from "../render/renderer";

interface Props {
  ruleset: Ruleset;
  players: string[];
  frame: SpectatorView | null;
  tickMs: number;
  /** Increment to snap to `frame` without animating (replay seeks). */
  jumpKey?: number;
  onHover?: (h: HoverInfo | null) => void;
  sound?: SoundSink;
  /** Hide the zoom buttons (e.g. the landing's background battle). */
  bare?: boolean;
}

/** Mounts the Pixi renderer and feeds it frames. */
export function GameCanvas({ ruleset, players, frame, tickMs, jumpKey = 0, onHover, sound, bare }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<GameRenderer | null>(null);
  const lastJump = useRef(jumpKey);

  useEffect(() => {
    let r: GameRenderer | null = null;
    let cancelled = false;
    GameRenderer.create(host.current!, ruleset, players).then((x) => {
      if (cancelled) return x.destroy();
      r = x;
      setRenderer(x);
    });
    return () => {
      cancelled = true;
      r?.destroy();
    };
  }, [ruleset, players.join(",")]);

  useEffect(() => {
    if (renderer && onHover) renderer.onHover(onHover);
  }, [renderer, onHover]);

  useEffect(() => {
    if (renderer) renderer.onSound(sound ?? (() => {}));
  }, [renderer, sound]);

  useEffect(() => {
    if (!renderer || !frame) return;
    const jump = lastJump.current !== jumpKey;
    lastJump.current = jumpKey;
    renderer.setFrame(frame, tickMs, jump);
  }, [renderer, frame, tickMs, jumpKey]);

  return (
    <div className="canvas-host" ref={host}>
      {!bare && (
        <div className="zoom">
          <button onClick={() => renderer?.zoom(1.25)} title="zoom in">+</button>
          <button onClick={() => renderer?.zoom(0.8)} title="zoom out">−</button>
        </div>
      )}
    </div>
  );
}
