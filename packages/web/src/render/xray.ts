import { Filter, GlProgram, UniformGroup, type Texture } from "pixi.js";

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

export function createXrayFilter(depth: Texture, outline = false): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment, name: "aoa-xray" }),
    resources: {
      uDepth: depth.source,
      xrayUniforms: new UniformGroup({ uScreen: { value: new Float32Array([depth.width, depth.height]), type: "vec2<f32>" }, uOutline: { value: outline ? 1 : 0, type: "f32" } }),
    },
  });
}

/** A depth code as a tint color (red = high byte, green = low byte). */
export function depthTint(z: number): number {
  const v = Math.max(0, Math.min(65535, Math.round(z)));
  return ((v >> 8) << 16) | ((v & 255) << 8) | 0xff;
}

/** Zero identifies neutral scenery, 1–4 identify the player's visual colour. */
export function occluderTint(z: number, colour?: number, building = false): number {
  return (depthTint(z) & 0xffff00) | (colour === undefined ? 0 : (colour + 1) * 40 + (building ? 10 : 0));
}

/** Preserve the owner's colour in the interior as well as the outline. */
export function xrayMark(colour: number, ring: boolean): number {
  return (colour * 2 + (ring ? 2 : 1)) * 28;
}
