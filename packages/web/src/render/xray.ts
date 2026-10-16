import { Filter, GlProgram, UniformGroup, type Texture } from "pixi.js";
import type { KindSpec } from "@aoa/shared";

/**
 * Only units hidden behind buildings of the SAME player colour are outlined.
 * Units, neutral scenery and other colours occlude normally, without x-ray.
 * Buildings themselves never enter the outline layer.
 *
 * The x-ray layer draws each unit's outline texture tinted with its depth code
 * (hi, lo, _) and the texture's blue channel encodes colour plus ring/interior.
 * `uDepth` holds the front-most occluder's depth in RG and colour in B per
 * screen pixel. The filter's output frame places its cropped input back in
 * screen coordinates, so depth sampling stays aligned while panning/zooming.
 */
const vertex = `in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vScreen = aPosition * uOutputFrame.zw + uOutputFrame.xy;
}`;

const fragment = `in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uDepth;
uniform vec2 uScreen;
uniform float uOutline;
float code(vec4 c) { return floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5); }
void main(void) {
  vec4 x = texture(uTexture, vTextureCoord);
  if (x.a < 0.5) { finalColor = vec4(0.0); return; }
  vec3 c = x.rgb / x.a;
  vec4 d = texture(uDepth, vScreen / uScreen);
  if (d.a < 0.5) { finalColor = vec4(0.0); return; }
  float mark = floor(c.b * 255.0 / 28.0 + 0.5);
  float colour = floor((mark - 1.0) / 2.0);
  float tag = floor(d.b / d.a * 255.0 + 0.5);
  float occluder = floor(tag / 40.0);
  if (occluder != colour + 1.0) { finalColor = vec4(0.0); return; }
  if (uOutline > 0.5) {
    finalColor = code(d) < code(vec4(c, 1.0)) ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(0.0);
    return;
  }
  // The +10 tag belongs only to buildings: units never activate x-ray.
  if (mod(tag, 40.0) != 10.0 || code(d) <= code(vec4(c, 1.0))) { finalColor = vec4(0.0); return; }
  if (mod(mark, 2.0) == 1.0) finalColor = vec4(0.0, 0.0, 0.0, 1.0);
  else if (colour == 0.0) finalColor = vec4(0.0, 0.0, 0.95, 1.0);
  else if (colour == 1.0) finalColor = vec4(0.95, 0.0, 0.0, 1.0);
  else if (colour == 2.0) finalColor = vec4(0.0, 0.95, 0.95, 1.0);
  else finalColor = vec4(0.95, 0.0, 0.95, 1.0);
}`;

/** Units hidden behind a building of their colour, drawn in their colour. */
export function createXrayFilter(depth: Texture): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment, name: "aoa-xray" }),
    resources: {
      uDepth: depth.source,
      xrayUniforms: new UniformGroup({ uScreen: { value: new Float32Array([depth.width, depth.height]), type: "vec2<f32>" }, uOutline: { value: 0, type: "f32" } }),
    },
  });
}

/** The ring of a unit passing behind another entity of its colour. */
export function createOutlineFilter(depth: Texture): Filter {
  const filter = createXrayFilter(depth);
  filter.resources.xrayUniforms.uniforms.uOutline = 1;
  return filter;
}

/** A depth code as a tint color (red = high byte, green = low byte). */
export function depthTint(z: number): number {
  const v = Math.max(0, Math.min(65535, Math.round(z)));
  return ((v >> 8) << 16) | ((v & 255) << 8) | 0xff;
}

/** Zero identifies neutral scenery, 1–4 identify the player's visual colour; buildings, the only occluders that reveal x-ray, add 10. */
export function occluderTint(z: number, colour?: number, kind?: KindSpec): number {
  return (depthTint(z) & 0xffff00) | (colour === undefined ? 0 : (colour + 1) * 40 + (kind?.building ? 10 : 0));
}

/**
 * RGBA mask pixels of a sprite: a white silhouette, per-colour x-ray codes
 * (ring or interior) and per-colour exterior rings. The ring holds pixels
 * within 3 stored px (1 screen px) of the edge along either axis.
 */
export function spriteMasks(src: Uint8ClampedArray, w: number, h: number, radius = 3) {
  const n = w * h;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = src[i * 4 + 3] > 127 ? 1 : 0;
  // Filled through 32-bit views: bytes R, G, B, A on little-endian hosts.
  const pixel = (b: number) => (0xff000000 | (b << 16) | 0xffff) >>> 0;
  const colours = [0, 1, 2, 3];
  // Codes keep the owner's colour in the interior as well as the ring.
  const core = colours.map((c) => pixel((c * 2 + 1) * 28));
  const ring = colours.map((c) => pixel((c * 2 + 2) * 28));
  const silhouette = new Uint32Array(n);
  const xray = colours.map(() => new Uint32Array(n));
  const outline = colours.map(() => new Uint32Array(n));
  const [x0, x1, x2, x3] = xray;
  const [o0, o1, o2, o3] = outline;
  // Keep approximately one world-pixel of outline at each distribution scale.
  const diameter = radius * 2 + 1;
  const column = new Uint8Array(w);
  for (let y = 0; y < Math.min(radius, h); y++) for (let x = 0; x < w; x++) column[x] += solid[y * w + x];
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < Math.min(radius, w); x++) row += solid[y * w + x];
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const s = solid[i];
      if (x + radius < w) row += solid[i + radius];
      if (y + radius < h) column[x] += solid[i + radius * w];
      const edge = s ? row < diameter || column[x] < diameter : row > 0 || column[x] > 0;
      if (x >= radius) row -= solid[i - radius];
      if (y >= radius) column[x] -= solid[i - radius * w];
      if (s) {
        silhouette[i] = 0xffffffff;
        const mark = edge ? ring : core;
        x0[i] = mark[0]; x1[i] = mark[1]; x2[i] = mark[2]; x3[i] = mark[3];
      } else if (edge) {
        o0[i] = ring[0]; o1[i] = ring[1]; o2[i] = ring[2]; o3[i] = ring[3];
      }
    }
  }
  const bytes = (a: Uint32Array<ArrayBuffer>) => new Uint8ClampedArray(a.buffer);
  return { silhouette: bytes(silhouette), xray: xray.map(bytes), outline: outline.map(bytes) };
}
