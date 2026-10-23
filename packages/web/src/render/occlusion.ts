import { Container, RenderTexture, type Filter, type Renderer, type Sprite } from "pixi.js";
import type { KindSpec } from "@castellan/shared";
import { createOutlineFilter, createXrayFilter, occluderTint } from "./xray";

/**
 * The x-ray's depth pass. Everything that can hide a unit mirrors a silhouette into
 * `layer`, tinted with its depth code, owner colour and kind (see `syncOccluder`); each
 * frame the pass renders them off-screen in the world's current view, and the x-ray and
 * outline filters read that texture to draw units behind occluders. The texture
 * survives resizes, since the filters keep references to it.
 */
export class OcclusionPass {
  /** Silhouettes of the occluders, kept in step with them by their owners. */
  readonly layer = new Container();
  private world = new Container();
  private texture?: RenderTexture;
  private xray?: Filter;
  private outline?: Filter;

  /** The layers the filters apply to: units' x-ray bodies and their outlines. */
  constructor(private xrayLayer: Container, private outlineLayer: Container) {
    this.layer.sortableChildren = true;
    this.world.addChild(this.layer);
  }

  /** The viewport in renderer pixels; the filters sample the depth texture per screen pixel. */
  resize(width: number, height: number) {
    if (this.texture) this.texture.resize(width, height);
    else this.texture = RenderTexture.create({ width, height, scaleMode: "nearest" });
    if (!this.xray || !this.outline) {
      this.xray = createXrayFilter(this.texture);
      this.xrayLayer.filters = [this.xray];
      this.outline = createOutlineFilter(this.texture);
      this.outlineLayer.filters = [this.outline];
      return;
    }
    for (const filter of [this.xray, this.outline]) {
      filter.resources.uDepth = this.texture.source;
      filter.resources.xrayUniforms.uniforms.uScreen = new Float32Array([width, height]);
    }
  }

  /** Draw the silhouettes as `world` is viewed now, for the filters to read this frame. */
  render(renderer: Pick<Renderer, "render">, world: Container) {
    if (!this.texture) return;
    this.world.position.copyFrom(world.position);
    this.world.scale.copyFrom(world.scale);
    renderer.render({ container: this.world, target: this.texture, clear: true, clearColor: [0, 0, 0, 0] });
  }

  /** Releases the depth texture, both filters and the silhouettes; their art is the shared sprite atlas and stays. */
  destroy() {
    this.xray?.destroy();
    this.outline?.destroy();
    this.texture?.destroy(true);
    this.world.destroy({ children: true });
  }
}

/** Mirror an occluder into the depth pass, tinted with its depth code, its owner's colour and its kind. */
export function syncOccluder(src: Sprite, depth: Sprite, colour?: number, kind?: KindSpec) {
  depth.position.copyFrom(src.position);
  depth.scale.copyFrom(src.scale);
  depth.anchor.copyFrom(src.anchor);
  depth.rotation = src.rotation;
  depth.zIndex = src.zIndex;
  depth.tint = occluderTint(src.zIndex, colour, kind);
  depth.visible = src.visible && src.alpha > 0.5;
}
