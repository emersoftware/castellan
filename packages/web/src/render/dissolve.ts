import { Filter, GlProgram, UniformGroup } from "pixi.js";
import { BAYER_GLSL } from "./bayer";
import { filterVertex } from "./filterVertex";

/**
 * Appear and disappear the game's way: a screen door of the same 4×4 Bayer pattern as the dither. At
 * `uShown` 0.5 half the cells show, at 1 all of them; nothing is blended, so the ramps stay pure.
 */
const vertex = filterVertex();

const fragment = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uShown;
${BAYER_GLSL}
void main(void) {
  if (bayer4(gl_FragCoord.xy) + 0.5 / 16.0 > uShown) discard;
  finalColor = texture(uTexture, vTextureCoord);
}`;

export function createDissolveFilter(): Filter & { shown: number } {
  const uniforms = new UniformGroup({ uShown: { value: 1, type: "f32" } });
  const filter = new Filter({ glProgram: GlProgram.from({ vertex, fragment, name: "castellan-dissolve" }), resources: { dissolveUniforms: uniforms } });
  return Object.defineProperty(filter, "shown", { get: () => uniforms.uniforms.uShown, set: (v: number) => { uniforms.uniforms.uShown = v; } }) as Filter & { shown: number };
}
