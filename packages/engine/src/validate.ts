import type { Order } from "@aoa/shared";

const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n);
const isStr = (s: unknown) => typeof s === "string" && s.length > 0 && s.length < 64;

/** Orders arrive as untrusted JSON. Returns a reason if the shape is wrong. */
export function validateOrder(o: unknown): string | null {
  if (!o || typeof o !== "object") return "order must be an object";
  const r = o as Record<string, unknown>;
  const need = (fields: Record<string, (v: unknown) => boolean>) => {
    for (const [k, ok] of Object.entries(fields)) if (!ok(r[k])) return `${r.type}: bad or missing "${k}"`;
    return null;
  };
  switch (r.type) {
    case "move": return need({ unit: isStr, x: isInt, y: isInt });
    case "attack": return need({ unit: isStr, target: isStr });
    case "gather": return need({ unit: isStr, deposit: (v) => v === undefined || isStr(v) });
    case "build": return need({ unit: isStr, kind: isStr, x: isInt, y: isInt });
    case "train": return need({ building: isStr, kind: isStr });
    case "stop": return need({ unit: isStr });
    case "script": return need({ kind: isStr, code: (v) => v === null || typeof v === "string" });
    case "chat": return need({ text: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200 });
    default: return `unknown order type "${String(r.type)}" (move, attack, gather, build, train, stop, script, chat)`;
  }
}

export type { Order };
