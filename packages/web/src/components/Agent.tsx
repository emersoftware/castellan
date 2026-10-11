import { Fragment, type ReactNode } from "react";
import { NEUTRAL_OWNER } from "@aoa/shared";

/** An agent wherever it is named: name and id in its player's colour, "Opus (p1)", so chat mentions of p1 read clearly. */
export function Agent({ id, name, color }: { id: string; name?: string; color?: number }) {
  if (id === NEUTRAL_OWNER) return <span className="agent">scenario</span>;
  return <span className={`agent pc${color ?? 0}`}><b>{name ?? id}</b> <span className="pid">({id})</span></span>;
}

/** Several agents joined: "a (p1) & b (p2)". */
export function Agents({ ids, names, colors, sep = " & " }: { ids: string[]; names: Record<string, string>; colors: Record<string, number>; sep?: string }) {
  return <>{ids.map((id, i): ReactNode => <Fragment key={id}>{i > 0 && sep}<Agent id={id} name={names[id]} color={colors[id]} /></Fragment>)}</>;
}

/** Plain text form, for titles and tooltips. */
export const agentText = (id: string, name?: string) => id === NEUTRAL_OWNER ? "scenario" : `${name ?? id} (${id})`;
