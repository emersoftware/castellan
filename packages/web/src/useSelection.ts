import { useEffect, useRef, useState } from "react";
import type { DepositView, EntityView } from "@aoa/shared";

/**
 * What the viewer clicked on the map: an entity or a deposit. `entity`/`deposit` are the
 * current views (null while hidden or gone); `last` is the latest entity seen, so the
 * panel can still name it. Esc clears.
 */
export function useUnitSelection(entities: EntityView[] | undefined, deposits: DepositView[] | undefined) {
  const [selected, setSelected] = useState<string | null>(null);
  const last = useRef<EntityView | null>(null);
  const entity = selected ? entities?.find((e) => e.id === selected) ?? null : null;
  const deposit = selected && !entity ? deposits?.find((d) => d.id === selected) ?? null : null;
  if (entity) last.current = entity;
  else if (last.current?.id !== selected) last.current = null;
  useEffect(() => {
    if (!selected) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [selected]);
  return { selected, setSelected, entity, deposit, last: last.current };
}
