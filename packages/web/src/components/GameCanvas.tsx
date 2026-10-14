import { useEffect, useRef, useState, type RefObject } from "react";
import type { Ruleset, SpectatorView } from "@aoa/shared";
import { GameRenderer, type HoverInfo, type SoundSink } from "../render/renderer";
import type { CameraBox } from "../showcaseCamera";

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
  /** The clicked entity id; the canvas draws a ring under it. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  sound?: SoundSink;
  /** Hide the zoom buttons (e.g. the landing's background battle). */
  bare?: boolean;
  /** Decorative previews should not consume wheel or drag gestures. */
  interactive?: boolean;
  /** Distribution appropriate for this viewport; interactive views use full art. */
  spriteBase?: string;
  /** Prepare the whole first frame while a preceding introduction is visible. */
  visible?: boolean;
  /** Decorative camera: tiles to frame, or `null` for the whole map. Omit to leave the view to the viewer. */
  focus?: CameraBox | null;
  /** With `focus`: the element over the canvas inside which shots are framed. Close-ups spill around it. */
  focusArea?: RefObject<HTMLElement | null>;
  /** Reassemble the first frame through dither: terrain, structures, then units. */
  reveal?: boolean;
  /** Called once the first frame is on screen. */
  onReady?: () => void;
}

/** Mounts the Pixi renderer and feeds it frames. */
export function GameCanvas({ ruleset, colors, frame, tickMs, paused = false, jumpKey = 0, onHover, selected = null, onSelect, sound, bare, interactive = true, spriteBase, visible = true, focus, focusArea, reveal = false, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [presented, setPresented] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Clear synchronously on cleanup: a reconnect can replace the ruleset and
  // deliver a frame in the same render, before the next Pixi instance is ready.
  const renderer = useRef<GameRenderer | null>(null);
  const [rendererVersion, setRendererVersion] = useState(0);
  const lastJump = useRef(jumpKey);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;
  const shown = useRef(false);
  const readyRaf = useRef(0);

  useEffect(() => {
    let r: GameRenderer | null = null;
    let cancelled = false;
    setFailed(false);
    setPresented(false);
    shown.current = false;
    GameRenderer.create(host.current!, ruleset, colors, { fitOnResize: bare, interactive, spriteBase }).then((x) => {
      if (cancelled) return x.destroy();
      r = x;
      if (reveal) x.prepareReveal();
      renderer.current = x;
      setRendererVersion((version) => version + 1);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(readyRaf.current);
      renderer.current = null;
      r?.destroy();
    };
  }, [ruleset, JSON.stringify(colors), bare, interactive, spriteBase, attempt, reveal]);

  useEffect(() => {
    if (onHover) renderer.current?.onHover(onHover);
  }, [rendererVersion, onHover]);

  useEffect(() => {
    if (onSelect) renderer.current?.onSelect(onSelect);
  }, [rendererVersion, onSelect]);

  useEffect(() => {
    renderer.current?.select(selected);
  }, [rendererVersion, selected]);

  useEffect(() => {
    renderer.current?.onSound(sound ?? (() => {}));
  }, [rendererVersion, sound]);

  useEffect(() => {
    const area = focusArea?.current, canvas = host.current, r = renderer.current;
    if (!area || !canvas || !r) return;
    // Layout can move the area without resizing it (fonts, text above), so watch its neighbours too.
    const measure = () => {
      const a = area.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      r.setFocusArea({ x: Math.round(a.left - c.left), y: Math.round(a.top - c.top), w: Math.round(a.width), h: Math.round(a.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of [area, canvas, ...(area.parentElement ? [...area.parentElement.children] : [])]) observer.observe(el);
    // On unmount the renderer is destroyed first; only a live one is reframed.
    return () => { observer.disconnect(); if (renderer.current === r) r.setFocusArea(undefined); };
  }, [rendererVersion, focusArea]);

  useEffect(() => {
    if (focus !== undefined) renderer.current?.focus(focus);
  }, [rendererVersion, focus]);

  useEffect(() => {
    renderer.current?.setPaused(paused);
  }, [rendererVersion, paused]);

  useEffect(() => {
    if (!renderer.current || !frame) return;
    const jump = lastJump.current !== jumpKey;
    lastJump.current = jumpKey;
    renderer.current.setFrame(frame, tickMs, jump);
    setPresented(true);
  }, [rendererVersion, frame, tickMs, jumpKey]);

  useEffect(() => {
    if (!renderer.current || !presented || !visible || shown.current) return;
    if (reveal) renderer.current.reveal();
    // Pixi draws on the next animation frame; report after it is painted.
    readyRaf.current = requestAnimationFrame(() => {
      readyRaf.current = requestAnimationFrame(() => {
        shown.current = true;
        readyCb.current?.();
      });
    });
    return () => cancelAnimationFrame(readyRaf.current);
  }, [rendererVersion, presented, visible, reveal]);

  return (
    <div className="canvas-host" ref={host} data-presented={presented && visible ? "" : undefined} style={{ visibility: (!presented || !visible) && !failed ? "hidden" : undefined }}>
      {failed && <div className="load-state" role="alert"><p>Couldn’t load the battlefield.</p><button onClick={() => setAttempt(a => a + 1)}>Try again</button></div>}
      {!bare && interactive && (
        <div className="zoom">
          <button onClick={() => renderer.current?.zoom(1.25)} title="zoom in">+</button>
          <button onClick={() => renderer.current?.zoom(0.8)} title="zoom out">−</button>
        </div>
      )}
    </div>
  );
}
