/**
 * A pixel arrow. The font's ← and → are hairlines one device pixel wide that
 * the dither's pixelation skips; this one is drawn on the CSS-pixel grid.
 */
export function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg className="arrow" width="11" height="7" viewBox="0 0 11 7" aria-hidden="true" shapeRendering="crispEdges"
      style={dir === "left" ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M0 3h10v1H0zM7 0h1v1H7zM8 1h1v1H8zM9 2h1v1H9zM9 4h1v1H9zM8 5h1v1H8zM7 6h1v1H7z" fill="currentColor" />
    </svg>
  );
}
