import { seatToMap, type DepositView, type MapSpec } from "@castellan/shared";

/** Each stage has its own silhouette; all three keep the same scale and anchor. */
export function depositSprite(amount: number, initialAmount: number): string {
  const remaining = amount / Math.max(1, initialAmount);
  return remaining > 2 / 3 ? "minerals-full" : remaining > 1 / 3 ? "minerals-half" : "minerals-low";
}

export function initialDepositAmount(map: MapSpec, deposit: DepositView): number {
  const shared = map.sharedDeposits.find((d) => d.x === deposit.x && d.y === deposit.y);
  if (shared) return shared.amount;
  // Each seat gets the listed deposits turned to its corner.
  const seats = map.seats === 4 ? 4 : 2;
  for (const d of map.deposits) {
    const positions = Array.from({ length: seats }, (_, seat) => seatToMap(d.x, d.y, seat, map.width, map.height));
    if (positions.some(([x, y]) => x === deposit.x && y === deposit.y)) return d.amount;
  }
  return Math.max(1, deposit.amount);
}
