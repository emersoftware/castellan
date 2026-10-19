import { Filter, GlProgram, UniformGroup } from "pixi.js";

/**
 * Appear and disappear the game's way: a screen door of the same 4×4 Bayer pattern as the dither. At
 * `uShown` 0.5 half the cells show, at 1 all of them; nothing is blended, so the ramps stay pure.
 */
const vertex = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const fragment = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uShown;
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main(void) {
  if (bayer4(gl_FragCoord.xy) + 0.5 / 16.0 > uShown) discard;
  finalColor = texture(uTexture, vTextureCoord);
}`;

export function createDissolveFilter(): Filter & { shown: number } {
  const uniforms = new UniformGroup({ uShown: { value: 1, type: "f32" } });
  const filter = new Filter({ glProgram: GlProgram.from({ vertex, fragment, name: "castellan-dissolve" }), resources: { dissolveUniforms: uniforms } });
  return Object.defineProperty(filter, "shown", { get: () => uniforms.uniforms.uShown, set: (v: number) => { uniforms.uniforms.uShown = v; } }) as Filter & { shown: number };
}
