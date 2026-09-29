import { useEffect, useRef, useState } from "react";
import type { Ruleset, SpectatorView } from "@aoa/shared";
import { GameRenderer, type HoverInfo, type SoundSink } from "../render/renderer";

interface Props {
  ruleset: Ruleset;
  /** Colour side (0/1) of each player id. */
  colors: Record<string, number>;
  frame: SpectatorView | null;
  tickMs: number;
  paused?: boolean;
  /** Increment to snap to `frame` without animating (replay seeks). */
  jumpKey?: number;
  onHover?: (h: HoverInfo | null) => void;
  sound?: SoundSink;
  /** Hide the zoom buttons (e.g. the landing's background battle). */
  bare?: boolean;
}

/** Mounts the Pixi renderer and feeds it frames. */
export function GameCanvas({ ruleset, colors, frame, tickMs, paused = false, jumpKey = 0, onHover, sound, bare }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // Clear synchronously on cleanup: a reconnect can replace the ruleset and
  // deliver a frame in the same render, before the next Pixi instance is ready.
  const renderer = useRef<GameRenderer | null>(null);
  const [rendererVersion, setRendererVersion] = useState(0);
  const lastJump = useRef(jumpKey);

  useEffect(() => {
    let r: GameRenderer | null = null;
    let cancelled = false;
    GameRenderer.create(host.current!, ruleset, colors).then((x) => {
      if (cancelled) return x.destroy();
      r = x;
      renderer.current = x;
      setRendererVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
      renderer.current = null;
      r?.destroy();
    };
  }, [ruleset, JSON.stringify(colors)]);

  useEffect(() => {
    if (onHover) renderer.current?.onHover(onHover);
  }, [rendererVersion, onHover]);

  useEffect(() => {
    renderer.current?.onSound(sound ?? (() => {}));
  }, [rendererVersion, sound]);

  useEffect(() => {
    renderer.current?.setPaused(paused);
  }, [rendererVersion, paused]);

  useEffect(() => {
    if (!renderer.current || !frame) return;
    const jump = lastJump.current !== jumpKey;
    lastJump.current = jumpKey;
    renderer.current.setFrame(frame, tickMs, jump);
  }, [rendererVersion, frame, tickMs, jumpKey]);

  return (
    <div className="canvas-host" ref={host}>
      {!bare && (
        <div className="zoom">
          <button onClick={() => renderer.current?.zoom(1.25)} title="zoom in">+</button>
          <button onClick={() => renderer.current?.zoom(0.8)} title="zoom out">−</button>
        </div>
      )}
    </div>
  );
}
