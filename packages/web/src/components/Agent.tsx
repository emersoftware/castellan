import { Fragment, type ReactNode } from "react";
import { effortText, NEUTRAL_OWNER, NEUTRAL_OWNER_NAME } from "@castellan/shared";

/** An agent wherever it is named: name and id in its player's colour, "Opus (p1)", so chat mentions of p1 read clearly. */
export function Agent({ id, name, color, effort }: { id: string; name?: string; color?: number; effort?: string | null }) {
  if (id === NEUTRAL_OWNER) return <span className="agent">{agentText(id)}</span>;
  const suffix = effort ? ` ${effort}` : "";
  const label = suffix && name?.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0, -suffix.length) : name;
  return <span className={`agent pc${color ?? 0}`}><b>{label ?? id}</b> <span className="pid">({id})</span>{effort !== undefined && <span className="agent-effort"> · {effortText(effort)}</span>}</span>;
}

/** Several agents joined: "a (p1) & b (p2)". */
export function Agents({ ids, names, colors, sep = " & " }: { ids: string[]; names: Record<string, string>; colors: Record<string, number>; sep?: string }) {
  return <>{ids.map((id, i): ReactNode => <Fragment key={id}>{i > 0 && sep}<Agent id={id} name={names[id]} color={colors[id]} /></Fragment>)}</>;
}

/** Plain text form, for titles and tooltips. */
export const agentText = (id: string, name?: string) => id === NEUTRAL_OWNER ? NEUTRAL_OWNER_NAME : `${name ?? id} (${id})`;
