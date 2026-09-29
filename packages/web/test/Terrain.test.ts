import { expect, it } from "vitest";
import { averageTerrainPatches } from "../src/render/terrain";

it("partitions each tile into four independently averaged half-tile squares", () => {
  // A linear field has an exact area mean at the centre of each square.
  expect([...averageTerrainPatches(1, 1, (x, y) => x + 2 * y)]).toEqual([0.75, 1.25, 1.75, 2.25]);
  expect(averageTerrainPatches(32, 64, () => 0.25)).toHaveLength(32 * 64 * 4);
});

it("averages the whole patch rather than taking one point sample", () => {
  // Half of the first patch is bright, although its centre is dark.
  const patches = averageTerrainPatches(1, 1, (x) => x < 0.25 ? 1 : 0);
  expect([...patches]).toEqual([0.5, 0, 0.5, 0]);
});
