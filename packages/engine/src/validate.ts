import { isChatChannel, type Order } from "@castellan/shared";

const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n);
const isStr = (s: unknown) => typeof s === "string" && s.length > 0 && s.length < 64;

/** The fields each order type needs, checked in this order. */
const FIELDS: Record<Order["type"], Record<string, (v: unknown) => boolean>> = {
  move: { unit: isStr, x: isInt, y: isInt },
  attack: { unit: isStr, target: isStr },
  gather: { unit: isStr, deposit: (v) => v === undefined || isStr(v) },
  build: { unit: isStr, kind: isStr, x: isInt, y: isInt },
  train: { building: isStr, kind: isStr },
  upgrade: { upgrade: isStr },
  stop: { unit: isStr },
  script: { kind: isStr, code: (v) => v === null || typeof v === "string" },
  chat: {
    text: (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200,
    channel: (v) => v === undefined || isChatChannel(v),
    to: (v) => v === undefined || isStr(v),
  },
};
const isOrderType = (type: unknown): type is Order["type"] => typeof type === "string" && Object.hasOwn(FIELDS, type);

/** Orders arrive as untrusted JSON. Returns a reason if the shape is wrong. */
export function validateOrder(o: unknown): string | null {
  if (!o || typeof o !== "object") return "order must be an object";
  const r = o as Record<string, unknown>;
  if (!isOrderType(r.type)) return `unknown order type "${String(r.type)}" (${Object.keys(FIELDS).join(", ")})`;
  for (const [k, ok] of Object.entries(FIELDS[r.type])) if (!ok(r[k])) return `${r.type}: bad or missing "${k}"`;
  return null;
}

export type { Order };
