import { useEffect, useRef } from "react";
import type { EntityKind } from "@castellan/shared";
import { PLAYER_RAMPS } from "../render/palette";
import { ditherPixels } from "../render/cpuDither";
import { isCharacter, normalizeCharacterContrast } from "../render/characterContrast";

/** Still portraits: a character's south-east view; other kinds are their own file. */
const FILES: Partial<Record<EntityKind, string>> = { king: "king_1", worker: "worker_1", knight: "knight_1", archer: "archer_1" };
/** Kinds whose atlases have an idle loop. */
const IDLE = new Set<EntityKind>(["king", "knight", "archer", "worker", "castle", "tower"]);
interface Idle { image: string; frameCount: number; fps: number; frameWidth: number; frameHeight: number; rows: string[] }
const imageLoads = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let image = imageLoads.get(src);
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    imageLoads.set(src, image);
  }
  return image;
}

/** The same source atlases and team ramps as the battlefield, at portrait size. */
export function Portrait({ kind, team = 0, height = 120, idle = false, spriteBase = "/game-assets/sprites" }: { kind: EntityKind; team?: number; height?: number; idle?: boolean; spriteBase?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const teamRef = useRef(team);
  teamRef.current = team;
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let visible = true;
    const cv = ref.current!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let started = false;
    const preload = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started || disposed) return;
      started = true;
      preload.disconnect();
      void prepare().catch(() => {});
    }, { rootMargin: "200px" });
    preload.observe(cv);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(cv);
    async function prepare() {
      let meta: Idle | undefined;
      if (idle && IDLE.has(kind)) {
        const manifest: { idle?: Idle } = await fetch(`${spriteBase}/${kind}/manifest.json`).then(r => r.ok ? r.json() : {});
        meta = manifest.idle;
      }
      let format = kind === "door" ? "svg" : "webp";
      if (!meta && spriteBase !== "/game-assets/sprites") {
        const manifest = await fetch(`${spriteBase}/manifest.json`).then(r => r.json());
        format = manifest.sprites[FILES[kind] ?? kind]?.format ?? format;
      }
      if (disposed) return;
      const img = await loadImage(meta ? `${spriteBase}/${kind}/${meta.image}` : `${spriteBase}/${FILES[kind] ?? kind}.${format}`);
      if (disposed) return;
      const source = document.createElement("canvas");
      source.width = meta?.frameWidth ?? (idle && isCharacter(kind) ? 112 : img.width);
      source.height = meta?.frameHeight ?? (idle && isCharacter(kind) ? 112 : img.height);
      const ctx = source.getContext("2d", { willReadFrequently: true })!;
      // Normalize the complete atlas once, so breathing never changes exposure.
      let atlas: CanvasImageSource = img;
      if (isCharacter(kind) && meta) {
        const normalized = document.createElement("canvas");
        normalized.width = img.width; normalized.height = img.height;
        const n = normalized.getContext("2d", { willReadFrequently: true })!;
        n.drawImage(img, 0, 0);
        const pixels = n.getImageData(0, 0, img.width, img.height);
        normalizeCharacterContrast(pixels.data); n.putImageData(pixels, 0, 0);
        atlas = normalized;
      }
      cv.width = Math.round(height * source.width / source.height); cv.height = height;
      const cache = new Map<string, HTMLCanvasElement>();
      let last = "";
      const draw = (now: number) => {
        if (disposed) return;
        if (visible && !document.hidden) {
          const frame = meta && !motion.matches ? Math.floor(now * meta.fps / 1000) % meta.frameCount : 0;
          const color = teamRef.current % PLAYER_RAMPS.length;
          const key = `${frame}:${color}`;
          if (key !== last) {
            let out = cache.get(key);
            if (!out) {
              ctx.clearRect(0, 0, source.width, source.height);
              if (meta) ctx.drawImage(atlas, frame * meta.frameWidth, Math.max(0, meta.rows.indexOf("se")) * meta.frameHeight, meta.frameWidth, meta.frameHeight, 0, 0, source.width, source.height);
              else ctx.drawImage(img, (source.width - img.width) / 2, idle && isCharacter(kind) ? 101.5 - img.height * 0.9565543071161049 : 0);
              const ramp = PLAYER_RAMPS[color];
              out = Object.assign(document.createElement("canvas"), { width: cv.width, height });
              const scaled = out.getContext("2d")!;
              scaled.imageSmoothingQuality = "high";
              scaled.drawImage(source, 0, 0, cv.width, height);
              const pixels = scaled.getImageData(0, 0, cv.width, height);
              // A still character is normalized at its display size; an idle atlas already was, whole.
              if (isCharacter(kind) && !meta) normalizeCharacterContrast(pixels.data);
              ditherPixels(pixels.data, cv.width, height, ramp, 1.1);
              scaled.putImageData(pixels, 0, 0);
              cache.set(key, out);
            }
            const display = cv.getContext("2d")!;
            display.clearRect(0, 0, cv.width, height); display.drawImage(out, 0, 0);
            last = key;
          }
        }
        raf = requestAnimationFrame(draw);
      };
      draw(performance.now());
    }
    return () => { disposed = true; cancelAnimationFrame(raf); preload.disconnect(); observer.disconnect(); };
  }, [kind, height, idle, spriteBase]);
  return <canvas ref={ref} className="portrait" aria-hidden="true" />;
}
