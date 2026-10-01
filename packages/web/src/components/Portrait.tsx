import { useEffect, useRef } from "react";
import { RAMPS, PLAYER_RAMPS } from "../render/palette";
import { ditherRamp } from "../render/cpuDither";
import { isCharacter, normalizeCharacterContrast } from "../render/characterContrast";

const FILES: Record<string, string> = { nexus: "castle", turret: "tower", deposit: "gold", agent: "king_1", king: "king_1", worker: "worker_1", knight: "knight_1", ranger: "ranger_1" };
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
export function Portrait({ kind, team = 0, height = 120, idle = false }: { kind: string; team?: number; height?: number; idle?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const teamRef = useRef(team);
  teamRef.current = team;
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let visible = true;
    const cv = ref.current!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(cv);
    async function prepare() {
      const canonical = kind === "nexus" ? "castle" : kind === "agent" ? "king" : kind;
      let meta: Idle | undefined;
      if (idle && ["king", "knight", "ranger", "worker", "castle", "turret"].includes(canonical)) {
        const manifest: { idle?: Idle } = await fetch(`/sprites/${canonical}/manifest.json`).then(r => r.ok ? r.json() : {});
        meta = manifest.idle;
      }
      const img = await loadImage(meta ? `/sprites/${canonical}/${meta.image}` : `/sprites/${FILES[kind] ?? kind}.${kind === "door" ? "svg" : "png"}`);
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
              const ramp = kind === "deposit" ? RAMPS.gold : kind === "rock" ? RAMPS.neutral : PLAYER_RAMPS[color];
              out = ditherRamp(source, cv.width, height, ramp, 1.1, isCharacter(kind) && !meta);
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
    void prepare().catch(() => {});
    return () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); };
  }, [kind, height, idle]);
  return <canvas ref={ref} className="portrait" aria-hidden="true" />;
}
