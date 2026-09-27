/**
 * An SVG filter that gives HTML the same ordered dither as the game canvas:
 * each channel (alpha included) is quantized to 4 levels with a 4×4 Bayer
 * threshold, so gradients, soft edges and translucent panels come out as
 * dot patterns. Colours are dimmed to 90% before the threshold so that no
 * colour sits exactly on a level: white text comes out white with light-grey
 * dots, and the letters themselves carry the dither. Use it through the CSS
 * rule in styles.css; never on the game canvas (it already has its own dither).
 *
 * The game canvas renders one pixel per CSS pixel. On high-density screens the
 * filter first pixelates the HTML to that same CSS-pixel grid (each device
 * pixel takes the colour of its cell's top-left one), so text and borders get
 * the same pixel size as the board.
 */
import { useEffect, useState } from "react";


const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Displacement scale, in CSS pixels, for the pixelation map. */
const SHIFT = 2;

// Tiles are built from floods, not feImage: Chrome resamples feImage and blurs
// the cells, while flood subregions snap to device pixels.

/** The 4×4 Bayer thresholds, one CSS pixel per cell. */
function bayerTile() {
  return (
    <>
      {BAYER.map((v, i) => {
        const g = Math.round(((v + 0.5) / 16) * 255);
        return <feFlood key={i} floodColor={`rgb(${g},${g},${g})`} x={i % 4} y={Math.floor(i / 4)} width="1" height="1" result={`b${i}`} />;
      })}
      <feMerge x="0" y="0" width="4" height="4" result="cell">
        {BAYER.map((_, i) => <feMergeNode key={i} in={`b${i}`} />)}
      </feMerge>
    </>
  );
}

/**
 * One CSS pixel of displacement map at `d` device pixels per CSS pixel: device
 * pixel (i, j) of the cell is sent back by (i/d, j/d) CSS px, to the cell origin.
 */
function pixelTile(d: number) {
  const level = (k: number) => Math.round((0.5 - k / (d * SHIFT)) * 255);
  const cells: [number, number][] = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) cells.push([i, j]);
  return (
    <>
      {cells.map(([i, j], n) => (
        <feFlood key={n} floodColor={`rgb(${level(i)},${level(j)},0)`} x={i / d} y={j / d} width={1 / d} height={1 / d} result={`p${n}`} />
      ))}
      <feMerge x="0" y="0" width="1" height="1" result="pcell">
        {cells.map((_, n) => <feMergeNode key={n} in={`p${n}`} />)}
      </feMerge>
    </>
  );
}

function useDevicePixels(): number {
  const [d, setD] = useState(() => Math.max(1, Math.round(window.devicePixelRatio || 1)));
  useEffect(() => {
    const q = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const update = () => setD(Math.max(1, Math.round(window.devicePixelRatio || 1)));
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, [d]);
  return d;
}

export function DitherDefs() {
  const d = useDevicePixels();
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <filter id="aoa-dither" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse">
        {d > 1 && pixelTile(d)}
        {d > 1 && <feTile in="pcell" x="0" y="0" width="100%" height="100%" result="pmap" />}
        {d > 1 && <feDisplacementMap in="SourceGraphic" in2="pmap" scale={SHIFT} xChannelSelector="R" yChannelSelector="G" result="source" />}
        {bayerTile()}
        <feTile in="cell" x="0" y="0" width="100%" height="100%" result="bayer" />
        <feComponentTransfer in={d > 1 ? "source" : "SourceGraphic"} result="dim">
          <feFuncR type="linear" slope="0.9" />
          <feFuncG type="linear" slope="0.9" />
          <feFuncB type="linear" slope="0.9" />
        </feComponentTransfer>
        {/* v = (3·c + t) / 4, so floor(4v) = floor(3c + t): the ordered-dither level.
            Arithmetic works on premultiplied colour; k2 + k3 = 1 keeps opaque pixels opaque. */}
        <feComposite in="dim" in2="bayer" operator="arithmetic" k1="0" k2="0.75" k3="0.25" k4="0" />
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues="0 0.33 0.66 1" />
          <feFuncG type="discrete" tableValues="0 0.33 0.66 1" />
          <feFuncB type="discrete" tableValues="0 0.33 0.66 1" />
          <feFuncA type="discrete" tableValues="0 0 1 1" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
