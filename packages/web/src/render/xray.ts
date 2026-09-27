import { Filter, GlProgram, UniformGroup, type Texture } from "pixi.js";

/**
 * Units hidden behind a building, a rock or a mine are drawn as an outline
 * in their side's color over a black interior (the AoE "x-ray"), only where
 * something in front covers them.
 *
 * The x-ray layer draws each unit's outline texture tinted with its depth code
 * (hi, lo, _) and the texture's blue channel says ring (team A 1.0, team B 0.6)
 * or interior (0.25). `uDepth` holds the front-most occluder's depth code per
 * screen pixel. The layer must cover the whole screen (filterArea = screen).
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
float code(vec4 c) { return floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5); }
void main(void) {
  vec4 x = texture(uTexture, vTextureCoord);
  if (x.a < 0.5) { finalColor = vec4(0.0); return; }
  vec3 c = x.rgb / x.a;
  vec4 d = texture(uDepth, vScreen / uScreen);
  if (d.a < 0.5 || code(d) <= code(vec4(c, 1.0))) { finalColor = vec4(0.0); return; }
  if (c.b > 0.8) finalColor = vec4(0.0, 0.0, 0.95, 1.0);
  else if (c.b > 0.45) finalColor = vec4(0.95, 0.0, 0.0, 1.0);
  else finalColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;

export function createXrayFilter(depth: Texture): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex, fragment, name: "aoa-xray" }),
    resources: {
      uDepth: depth.source,
      xrayUniforms: new UniformGroup({ uScreen: { value: new Float32Array([depth.width, depth.height]), type: "vec2<f32>" } }),
    },
  });
}

/** A depth code as a tint color (red = high byte, green = low byte). */
export function depthTint(z: number): number {
  const v = Math.max(0, Math.min(65535, Math.round(z)));
  return ((v >> 8) << 16) | ((v & 255) << 8) | 0xff;
}
