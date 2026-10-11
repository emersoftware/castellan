/** Match shadow/midtone/highlight levels before tinting. Measure the whole
 * atlas once, never individual frames, so changing poses cannot cause flicker.
 */
export function normalizeCharacterContrast(pixels: Uint8ClampedArray): void {
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    histogram[pixels[i]]++;
    count++;
  }
  if (!count) return;
  const percentile = (fraction: number) => {
    let total = 0;
    for (let value = 0; value < 256; value++) {
      total += histogram[value];
      if (total >= count * fraction) return value;
    }
    return 255;
  };
  const low = percentile(0.05), high = percentile(0.95);
  if (high - low < 16) return;
  const middle = Math.max(low + 1, Math.min(high - 1, percentile(0.5)));
  const curve = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    const mapped = value < low ? value / Math.max(1, low) * 24
      : value < middle ? 24 + (value - low) / (middle - low) * 104
      : value < high ? 128 + (value - middle) / (high - middle) * 104
      : 232 + (value - high) / Math.max(1, 255 - high) * 23;
    curve[value] = Math.round(mapped);
  }
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = curve[pixels[i]];
  }
}

export const isCharacter = (name: string) => /^(agent|king|knight|archer|worker)(?:_\d+)?$/.test(name);
