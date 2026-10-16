// A leaf that plain Node imports too (scripts/runtime-assets.mjs): only erasable syntax and `.ts` relative imports.
import { ENTITY_KINDS, type EntityKind } from "../../../shared/src/ruleset.ts";

/** Art drawn from animation clips: each kind, and the pieces a barrier shows. */
export type ClipArt = EntityKind | "wallpost" | "door-open" | "wall-door-left" | "wall-door-right" | "wall-door-both";
export const CLIP_ART: readonly ClipArt[] = [...ENTITY_KINDS, "wallpost", "door-open", "wall-door-left", "wall-door-right", "wall-door-both"];
