/**
 * Pixi's filter vertex stage: maps the filter quad to clip space and passes the input
 * texture coordinate. With `screen`, it also passes the fragment's screen position
 * (`vScreen`), for filters that sample a full-screen texture.
 */
export function filterVertex({ screen = false } = {}): string {
  return `in vec2 aPosition;
out vec2 vTextureCoord;${screen ? "\nout vec2 vScreen;" : ""}
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);${screen ? "\n  vScreen = aPosition * uOutputFrame.zw + uOutputFrame.xy;" : ""}
}`;
}
