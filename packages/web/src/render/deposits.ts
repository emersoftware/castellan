import type { DepositView, MapSpec } from "@aoa/shared";

/** Each stage has its own silhouette; all three keep the same scale and anchor. */
export function depositSprite(amount: number, initialAmount: number): string {
  const remaining = amount / Math.max(1, initialAmount);
  return remaining > 2 / 3 ? "minerals-full" : remaining > 1 / 3 ? "minerals-half" : "minerals-low";
}

export function initialDepositAmount(map: MapSpec, deposit: DepositView): number {
  const shared = map.sharedDeposits.find((d) => d.x === deposit.x && d.y === deposit.y);
  if (shared) return shared.amount;
  for (const d of map.deposits) {
    const positions = [[d.x, d.y], [map.width - 1 - d.x, map.height - 1 - d.y]];
    if (map.seats === 4) positions.push([map.width - 1 - d.y, d.x], [d.y, map.height - 1 - d.x]);
    if (positions.some(([x, y]) => x === deposit.x && y === deposit.y)) return d.amount;
  }
  return Math.max(1, deposit.amount);
}
