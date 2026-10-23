/* eslint-disable @typescript-eslint/no-magic-numbers -- FNV-1a's published offset and prime, byte offsets and the hex width. */

/** 32-bit FNV-1a over the low three bytes of each mixed number: the replay desync fingerprint. Changing it breaks every recorded hash. */
export function fingerprint() {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  };
  return { mix, digest: () => (h >>> 0).toString(16).padStart(8, "0") };
}
