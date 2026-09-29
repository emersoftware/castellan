/** One mean brightness per half-tile square: exactly four patches per map tile. */
export function averageTerrainPatches(width: number, height: number, brightness: (x: number, y: number) => number): Float32Array {
  const columns = width * 2;
  const rows = height * 2;
  const means = new Float32Array(columns * rows);
  // Uniform midpoint samples approximate the area mean, not just its centre.
  const samples = 4;
  for (let py = 0; py < rows; py++) {
    for (let px = 0; px < columns; px++) {
      let sum = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          sum += brightness((px + (sx + 0.5) / samples) / 2, (py + (sy + 0.5) / samples) / 2);
        }
      }
      means[py * columns + px] = sum / (samples * samples);
    }
  }
  return means;
}
