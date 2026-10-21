import { TILE_H, TILE_W } from "./sprites";

export const iso = (x: number, y: number) => ({ sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) });
